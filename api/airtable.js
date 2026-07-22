const AIRTABLE_API = "https://api.airtable.com/v0";
const DEFAULT_TABLE = "PT Sync";
const SYNC_KEY = "pt-state";

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

async function findSyncRecord(config) {
  const params = new URLSearchParams({
    pageSize: "1",
    filterByFormula: `{Key}='${SYNC_KEY}'`
  });
  params.append("fields[]", "Key");
  params.append("fields[]", "Data");
  const body = await airtableFetch(config, tableUrl(config, `?${params.toString()}`));
  return body.records?.[0] || null;
}

async function listLegacyRecords(config) {
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

function decodeRecord(record) {
  try {
    return JSON.parse(record.fields?.Data || "{}");
  } catch {
    return {};
  }
}

async function pull(config) {
  const record = await findSyncRecord(config);
  if (record) return decodeRecord(record);

  const records = await listLegacyRecords(config);
  return records.reduce((acc, legacyRecord) => {
    const key = legacyRecord.fields?.Key;
    if (key && key !== SYNC_KEY) acc[key] = decodeRecord(legacyRecord);
    return acc;
  }, {});
}

async function push(config, data) {
  const record = await findSyncRecord(config);
  const fields = { Key: SYNC_KEY, Data: JSON.stringify(data || {}) };
  if (record) {
    await airtableFetch(config, tableUrl(config, `/${record.id}`), {
      method: "PATCH",
      body: JSON.stringify({ fields })
    });
  } else {
    await airtableFetch(config, tableUrl(config), {
      method: "POST",
      body: JSON.stringify({ fields })
    });
  }
  return data || {};
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
