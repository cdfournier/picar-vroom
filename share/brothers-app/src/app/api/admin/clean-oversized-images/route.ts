import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Anthropic's many-image request limit: each image must be ≤2000px on
// its longest dimension. When a conversation accumulates oversized
// images (typically Mac Retina screenshots at 2880x1800), every API
// call to that conversation 400s.
//
// This endpoint surgically removes the oversized image content blocks
// without disrupting compaction or losing the message structure.
// Replaced blocks become text placeholders so the conversation flow
// is preserved.
//
// Usage:
//   GET /api/admin/clean-oversized-images?conversation_id=conv_dom_1774084168402
//   Optional: &max_dimension=2000 (defaults to 2000)
//   Optional: &dry_run=true (preview without writing)

const DEFAULT_MAX_DIMENSION = 2000;

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversation_id");
  if (!conversationId) {
    return NextResponse.json(
      { error: "conversation_id query param required" },
      { status: 400 }
    );
  }

  const maxDimension = parseInt(
    req.nextUrl.searchParams.get("max_dimension") || String(DEFAULT_MAX_DIMENSION),
    10
  );
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "true";

  // Fetch all messages for this conversation
  const { data: rows, error } = await supabase
    .from("conversation_messages")
    .select("id, position, role, content")
    .eq("conversation_id", conversationId)
    .order("position", { ascending: true });

  if (error || !rows) {
    return NextResponse.json(
      { error: `Failed to fetch messages: ${error?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  const debug = req.nextUrl.searchParams.get("debug") === "true";

  const removals: Array<{
    message_id: number;
    position: number;
    location: string; // "top" or "tool_result[idx]"
    block_index: number;
    dimensions: { width: number; height: number };
    media_type: string;
    role: string;
  }> = [];

  // Debug mode collects EVERY image found, regardless of size.
  const allImagesDebug: Array<{
    position: number;
    location: string;
    block_index: number;
    dimensions: { width: number; height: number } | null;
    media_type: string;
    source_type: string;
    role: string;
  }> = [];

  const updates: Array<{ id: number; content: unknown }> = [];

  // Recursive transform: walks a content-blocks array and replaces any
  // oversized image block (including ones nested inside tool_result.content).
  // Returns the new array and whether anything changed.
  function transformContent(
    blocks: Array<Record<string, unknown>>,
    rowId: number,
    position: number,
    role: string,
    locationPrefix: string
  ): { result: Array<Record<string, unknown>>; modified: boolean } {
    let modified = false;
    const result = blocks.map((block, blockIdx) => {
      // Recurse into tool_result blocks (they have their own .content array)
      if (block.type === "tool_result" && Array.isArray(block.content)) {
        const nested = transformContent(
          block.content as Array<Record<string, unknown>>,
          rowId,
          position,
          role,
          `${locationPrefix}tool_result[${blockIdx}].`
        );
        if (nested.modified) {
          modified = true;
          return { ...block, content: nested.result };
        }
        return block;
      }

      // Image block at this level
      if (block.type !== "image") return block;
      const source = block.source as Record<string, unknown> | undefined;
      const sourceType = (source?.type as string) || "unknown";
      const mediaType = (source?.media_type as string) || "image/jpeg";

      let dims: { width: number; height: number } | null = null;
      if (sourceType === "base64" && typeof source?.data === "string") {
        const buf = Buffer.from(source.data as string, "base64");
        dims = getImageDimensions(buf, mediaType);
      }

      if (debug) {
        allImagesDebug.push({
          position,
          location: `${locationPrefix}content[${blockIdx}]`,
          block_index: blockIdx,
          dimensions: dims,
          media_type: mediaType,
          source_type: sourceType,
          role,
        });
      }

      if (!dims) return block; // can't parse — leave alone
      if (Math.max(dims.width, dims.height) <= maxDimension) return block;

      // Oversized — record and replace
      removals.push({
        message_id: rowId,
        position,
        location: `${locationPrefix}content[${blockIdx}]`,
        block_index: blockIdx,
        dimensions: dims,
        media_type: mediaType,
        role,
      });
      modified = true;
      return {
        type: "text",
        text: `[Image removed during cleanup: original was ${dims.width}×${dims.height}px ${mediaType}, exceeded Anthropic's ${maxDimension}px many-image limit. Position in conversation: ${position}.]`,
      };
    });
    return { result, modified };
  }

  for (const row of rows) {
    if (!Array.isArray(row.content)) continue;
    const content = row.content as Array<Record<string, unknown>>;
    const transformed = transformContent(
      content,
      row.id as number,
      row.position as number,
      row.role as string,
      ""
    );
    if (transformed.modified) {
      updates.push({ id: row.id as number, content: transformed.result });
    }
  }

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      conversation_id: conversationId,
      max_dimension: maxDimension,
      total_messages_scanned: rows.length,
      messages_to_modify: updates.length,
      images_to_remove: removals.length,
      removals,
      ...(debug
        ? {
            debug_all_images: allImagesDebug,
            debug_image_count: allImagesDebug.length,
          }
        : {}),
    });
  }

  // Apply updates
  let applied = 0;
  let failed = 0;
  for (const upd of updates) {
    const { error: updErr } = await supabase
      .from("conversation_messages")
      .update({ content: upd.content })
      .eq("id", upd.id);
    if (updErr) {
      failed++;
      console.error(`Failed to update message ${upd.id}:`, updErr);
    } else {
      applied++;
    }
  }

  // Invalidate the in-memory cache for this conversation so the next
  // sendMessage call loads the cleaned version from Supabase rather than
  // using the stale in-memory copy that still has the oversized images.
  const globalStore = globalThis as unknown as {
    _conversations?: Map<string, unknown>;
  };
  let cacheInvalidated = false;
  if (globalStore._conversations) {
    cacheInvalidated = globalStore._conversations.delete(conversationId);
  }

  return NextResponse.json({
    conversation_id: conversationId,
    max_dimension: maxDimension,
    total_messages_scanned: rows.length,
    messages_modified: applied,
    messages_failed: failed,
    images_removed: removals.length,
    cache_invalidated: cacheInvalidated,
    removals,
  });
}

// -----------------------------------------------------------------------
// Image dimension parsing from raw base64-decoded bytes
// -----------------------------------------------------------------------
//
// Avoids pulling in an image library (sharp/jimp) just for dimensions.
// PNG and JPEG headers are well-defined; we read width/height directly.

function getImageDimensions(
  buf: Buffer,
  mediaType: string
): { width: number; height: number } | null {
  const mt = mediaType.toLowerCase();
  if (mt === "image/png") return parsePngDimensions(buf);
  if (mt === "image/jpeg" || mt === "image/jpg") return parseJpegDimensions(buf);
  if (mt === "image/gif") return parseGifDimensions(buf);
  if (mt === "image/webp") return parseWebpDimensions(buf);
  return null;
}

function parsePngDimensions(buf: Buffer): { width: number; height: number } | null {
  // PNG signature: 8 bytes. IHDR chunk follows.
  // Width at offset 16-19, height at 20-23 (big-endian uint32).
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function parseJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  // JPEG: scan for SOF (Start of Frame) marker.
  // Markers are 0xFF followed by marker byte.
  // SOF0..SOF15 = 0xC0..0xCF, except 0xC4 (DHT), 0xC8 (JPG), 0xCC (DAC).
  if (buf.length < 4) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    // Skip fill bytes (0xFF padding)
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) break;
    const marker = buf[i];
    i++;

    // Standalone markers (no payload): SOI, EOI, RSTn
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    // Read segment length (big-endian uint16)
    if (i + 2 > buf.length) break;
    const segLen = buf.readUInt16BE(i);

    // SOF markers: 0xC0..0xCF except 0xC4, 0xC8, 0xCC
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isSof) {
      // SOF segment: [length:2][precision:1][height:2][width:2]...
      if (i + 7 > buf.length) return null;
      return {
        height: buf.readUInt16BE(i + 3),
        width: buf.readUInt16BE(i + 5),
      };
    }
    // Skip this segment's payload
    i += segLen;
  }
  return null;
}

function parseGifDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 10) return null;
  // GIF87a or GIF89a signature
  if (buf[0] !== 0x47 || buf[1] !== 0x49 || buf[2] !== 0x46) return null;
  return {
    width: buf.readUInt16LE(6),
    height: buf.readUInt16LE(8),
  };
}

function parseWebpDimensions(buf: Buffer): { width: number; height: number } | null {
  // RIFF...WEBP container. Then VP8/VP8L/VP8X chunk.
  if (buf.length < 30) return null;
  if (
    buf[0] !== 0x52 || buf[1] !== 0x49 || buf[2] !== 0x46 || buf[3] !== 0x46 ||
    buf[8] !== 0x57 || buf[9] !== 0x45 || buf[10] !== 0x42 || buf[11] !== 0x50
  ) {
    return null;
  }
  const chunkType = buf.slice(12, 16).toString("ascii");
  if (chunkType === "VP8X") {
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    };
  }
  if (chunkType === "VP8L") {
    // Lossless: complex bit packing
    if (buf.length < 25) return null;
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunkType === "VP8 ") {
    // Lossy: width/height at offset 26 and 28 (16-bit LE), but high bits are reserved
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}
