import { readFile } from "node:fs/promises";

export async function loadDotEnv(filePath = ".env", target = process.env) {
  let text = "";

  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        loaded: false,
        filePath,
        keys: []
      };
    }
    throw error;
  }

  const keys = [];

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    if (target[parsed.key] === undefined) {
      target[parsed.key] = parsed.value;
    }
    keys.push(parsed.key);
  }

  return {
    loaded: true,
    filePath,
    keys
  };
}

export function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  const rawValue = trimmed.slice(separatorIndex + 1).trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  return {
    key,
    value: unquote(rawValue)
  };
}

function unquote(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
