// Attaches screenshots to a Confluence page, and prints the ids needed to embed
// them in its body.
//
// Why this exists: the Atlassian connector the assistant talks to can create and
// edit pages but has no attachment scope at all, and an <img src="data:…"> in a
// page body does not work — Confluence stores it as an *external* image and
// renders "Preview unavailable", because its media proxy cannot fetch a data URI.
// A real attachment is the only way an image lives inside a page. That needs the
// v1 REST API and an API token from id.atlassian.com → Security → API tokens.
//
// Usage:
//   CONFLUENCE_EMAIL=you@first-edea.com CONFLUENCE_TOKEN=… \
//     node scripts/confluence-attach.mjs <pageId> docs/screenshots/*.png
//
// Prints one JSON object mapping each filename to the { fileId, collection } pair
// that an embed needs:
//   <div data-type="media-single"><div data-type="media" data-media-type="file"
//        data-id="<fileId>" data-collection="<collection>"></div></div>

import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';

const SITE = process.env.CONFLUENCE_SITE ?? 'first-edea-team.atlassian.net';
const EMAIL = process.env.CONFLUENCE_EMAIL;
const TOKEN = process.env.CONFLUENCE_TOKEN;
const [pageId, ...files] = process.argv.slice(2);

if (!EMAIL || !TOKEN) throw new Error('set CONFLUENCE_EMAIL and CONFLUENCE_TOKEN');
if (!pageId || !files.length) throw new Error('usage: confluence-attach.mjs <pageId> <file…>');

const auth = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const api = `https://${SITE}/wiki/rest/api/content/${pageId}/child/attachment`;
// Without this header Confluence rejects the upload as a suspected XSRF attempt.
const headers = { Authorization: auth, 'X-Atlassian-Token': 'no-check' };

/** The attachment already on the page under this name, if there is one. */
async function existing(name) {
  const res = await fetch(`${api}?filename=${encodeURIComponent(name)}`, {
    headers: { ...headers, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`listing attachments failed (${res.status}): ${await res.text()}`);
  const { results } = await res.json();
  return results[0];
}

async function upload(path) {
  const name = basename(path);
  const form = new FormData();
  form.append('file', new Blob([await readFile(path)], { type: 'image/png' }), name);
  form.append('minorEdit', 'true');

  // Re-posting a name that is already there is an error rather than a replacement,
  // so an existing attachment is updated through its own data endpoint. That keeps
  // the fileId stable, which means a re-run does not break embeds already in place.
  const prior = await existing(name);
  const res = await fetch(prior ? `${api}/${prior.id}/data` : api, {
    method: 'POST', headers, body: form,
  });
  if (!res.ok) throw new Error(`${name}: upload failed (${res.status}) ${await res.text()}`);

  const body = await res.json();
  const att = body.results ? body.results[0] : body;
  const { fileId, collectionName } = att.extensions ?? {};
  if (!fileId) throw new Error(`${name}: no fileId in the response — ${JSON.stringify(att.extensions)}`);
  return [name, { fileId, collection: collectionName ?? `contentId-${pageId}` }];
}

const out = {};
for (const path of files) {
  const [name, ids] = await upload(path);
  out[name] = ids;
  console.error('  ✓', name);
}
console.log(JSON.stringify(out, null, 2));
