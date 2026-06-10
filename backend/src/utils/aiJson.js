/**
 * Parse JSON returned by a chat model, tolerating a markdown code fence.
 *
 * OpenAI's `response_format: json_object` guarantees the content is a bare JSON
 * object. The OpusMax gateway (Claude) honors json_object best-effort but can
 * still wrap the JSON in a ```json … ``` fence (prompt-dependent), which makes a
 * naive JSON.parse throw. This strips a surrounding fence (and, as a last
 * resort, extracts the outermost {...}/[...] span) before parsing.
 *
 * @param {string} content Raw model message content.
 * @returns {any} The parsed value.
 * @throws {SyntaxError|Error} If no JSON can be parsed.
 */
export function parseAiJson(content) {
  if (content === null || content === undefined) {
    throw new Error('No content to parse as JSON');
  }
  let s = String(content).trim();

  // Strip a surrounding markdown code fence: ```json\n…\n``` or ```\n…\n```.
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?[ \t]*\r?\n?/i, '').replace(/\r?\n?```[ \t]*$/i, '').trim();
  }

  try {
    return JSON.parse(s);
  } catch (err) {
    // Last resort: the model wrapped the JSON in prose. Extract the outermost
    // object/array span and try again.
    const span = s.match(/[{[][\s\S]*[}\]]/);
    if (span) {
      return JSON.parse(span[0]);
    }
    throw err;
  }
}

export default parseAiJson;
