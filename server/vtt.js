// YouTube's auto-generated captions use a "rolling karaoke" VTT format: each
// cue block contains up to two lines — a static top line (a repeat of the
// previous cue's bottom line) and a growing bottom line that gains words
// cue-by-cue. Naively joining/listing cues produces a heavily duplicated,
// unreadable transcript. This module reconstructs a clean, deduplicated,
// timestamped transcript by tracking only each cue's growing (last) line.

function parseVttTime(str) {
  const m = /(\d+):(\d+):(\d+)\.(\d+)/.exec(str);
  if (!m) return 0;
  const [, h, mi, s, ms] = m;
  return Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms) / 1000;
}

function stripTags(line) {
  return line.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function parseVttCues(vttText) {
  const blocks = vttText
    .replace(/\r\n/g, "\n")
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timeLineIndex = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIndex === -1) continue;

    const [startStr] = lines[timeLineIndex].split("-->").map((s) => s.trim().split(" ")[0]);
    const textLines = lines
      .slice(timeLineIndex + 1)
      .map(stripTags)
      .filter(Boolean);

    if (textLines.length > 0) {
      // Only the last line is the "growing" current line — any earlier line
      // in the same block is always a repeat of the previous cue's last line.
      cues.push({ start: parseVttTime(startStr), text: textLines[textLines.length - 1] });
    }
  }
  return cues;
}

/** Collapses cue-to-cue growth (same line gaining words) into a plain word stream. */
function dedupeRollingCaptions(cues) {
  let known = "";
  const stream = [];
  for (const cue of cues) {
    const { text, start } = cue;
    if (!text || text === known) continue;
    if (known.length > 0 && text.startsWith(known)) {
      const suffix = text.slice(known.length).trim();
      if (suffix) stream.push({ time: start, text: suffix });
    } else if (known.length > 0 && known.startsWith(text)) {
      continue; // shrank back to a prefix — transitional artifact, no new content
    } else {
      stream.push({ time: start, text });
    }
    known = text;
  }
  return stream;
}

/** Groups the word stream into readable chunks, breaking on sentence punctuation or a word cap. */
function groupIntoChunks(stream, maxWords = 16) {
  const chunks = [];
  let current = null;

  for (const { time, text } of stream) {
    for (const word of text.split(/\s+/).filter(Boolean)) {
      if (!current) current = { start: time, words: [] };
      current.words.push(word);
      if (current.words.length >= maxWords || /[.!?]$/.test(word)) {
        chunks.push({ start: current.start, text: current.words.join(" ") });
        current = null;
      }
    }
  }
  if (current && current.words.length > 0) {
    chunks.push({ start: current.start, text: current.words.join(" ") });
  }
  return chunks;
}

export function vttToTranscript(vttText) {
  const cues = parseVttCues(vttText);
  const stream = dedupeRollingCaptions(cues);
  return groupIntoChunks(stream);
}
