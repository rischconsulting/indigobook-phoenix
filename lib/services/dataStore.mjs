export class DataStore {
  constructor(rootURI) {
    this.rootURI = rootURI;
    this.cache = new Map();
  }

  async init() {
    await Promise.all([
      this.loadJSON('data/auto-us.json').catch(() => null),
      this.loadJSON('data/juris-us-map.json').catch(() => null),
      this.loadJSON('data/primary-jurisdictions.json').catch(() => null),
      this.loadJSON('data/primary-us.json').catch(() => null),
      this.loadJSON('data/secondary-us-bluebook.json').catch(() => null),
      this.loadJSON('style-modules/index.json').catch(() => null),
    ]);
  }


async loadText(relPath) {
  if (this.cache.has(relPath)) return this.cache.get(relPath);

  const url = this.rootURI.spec + relPath;

  // Zotero.HTTP.request handles https:, jar:, resource:, and file: URIs.
  // Zotero.File.getContentsAsync(uri) is deprecated in Zotero 8.
  const req = await Zotero.HTTP.request("GET", url);
  const text = req.response;

  this.cache.set(relPath, text);
  return text;
}


  async loadJSON(relPath) {
    if (this.cache.has(relPath)) return this.cache.get(relPath);
    const text = await this.loadText(relPath);
    const obj = JSON.parse(text);
    this.cache.set(relPath, obj);
    return obj;
  }
}
