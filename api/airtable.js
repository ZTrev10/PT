const AIRTABLE_API = "https://api.airtable.com/v0";
const DEFAULT_TABLE = "PT Sync";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function getConfig() {
  return {
    token: process.env.AIRTABLE_TOKEN,
    baseId: process.env.AIRTABLE_BASE_ID,
    tableName: process.env.AIRTABLE_TABLE_NAME || DEFAULT_TABLE
  };
}

function tableUrl(config, path = "") {
  return `${AIRTABLE_API}/${config.baseId}/${encodeURIComponent(config.tableName)}${path}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function airtableFetch(config, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = body?.error?.message || body?.error || "Airtable request failed";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function listRecords(config) {
  const records = [];
  let offset = "";
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    params.append("fields[]", "Key");
    params.append("fields[]", "Data");
    if (offset) params.set("offset", offset);
    const body = await airtableFetch(config, tableUrl(config, `?${params.toString()}`));
    records.push(...(body.records || []));
    offset = body.offset || "";
  } while (offset);
  return records;
}

async function getRecordMap(config) {
  const records = await listRecords(config);
  return records.reduce((acc, record) => {
    const key = record.fields?.Key;
    if (key) acc[key] = record;
    return acc;
  }, {});
}

function decodeRecord(record) {
  try {
    return JSON.parse(record.fields?.Data || "{}");
  } catch {
    return {};
  }
}

async function pull(config) {
  const map = await getRecordMap(config);
  return Object.fromEntries(
    Object.entries(map).map(([key, record]) => [key, decodeRecord(record)])
  );
}

async function push(config, data) {
  const existing = await getRecordMap(config);
  const keys = Object.keys(data || {});
  await Promise.all(keys.map((key) => {
    const fields = { Key: key, Data: JSON.stringify(data[key] ?? {}) };
    const record = existing[key];
    if (record) {
      return airtableFetch(config, tableUrl(config, `/${record.id}`), {
        method: "PATCH",
        body: JSON.stringify({ fields })
      });
    }
    return airtableFetch(config, tableUrl(config), {
      method: "POST",
      body: JSON.stringify({ fields })
    });
  }));
  return pull(config);
}

module.exports = async function handler(req, res) {
  const config = getConfig();
  if (!config.token || !config.baseId) {
    return json(res, 500, {
      error: "Missing Airtable settings. Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID."
    });
  }

  try {
    if (req.method === "GET") return json(res, 200, { data: await pull(config) });
    if (req.method === "POST") {
      const body = await readBody(req);
      return json(res, 200, { data: await push(config, body.data || {}) });
    }
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Sync failed" });
  }
};
