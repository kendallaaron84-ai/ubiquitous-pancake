export function createMemoryDb(seed = {}, options = {}) {
  const docs = new Map(Object.entries(seed));
  const metrics = {
    documentGets: 0,
    documentWrites: 0,
    queryGets: 0,
    batchGets: 0,
    batchDocuments: 0,
  };
  const latency = options.latencyMs || {};
  const wait = async (kind) => {
    const milliseconds = Number(latency[kind] || 0);
    if (milliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    }
  };
  const makeSnapshot = (path) => ({
    exists: docs.has(path),
    id: path.split("/").pop(),
    ref: makeDoc(path),
    data: () => docs.get(path),
  });
  const makeQuery = (collection, filters = [], max = Infinity) => ({
    _query: true,
    collection,
    filters,
    max,
    where(field, op, value) {
      return makeQuery(collection, [...filters, [field, op, value]], max);
    },
    limit(value) {
      return makeQuery(collection, filters, value);
    },
    async get() {
      metrics.queryGets += 1;
      await wait("queryGet");
      return querySnapshot(this);
    },
  });
  const querySnapshot = (query) => {
    const found = [...docs.entries()]
      .filter(
        ([path, data]) =>
          path.startsWith(`${query.collection}/`) &&
          path.split("/").length === 2 &&
          query.filters.every(
            ([field, op, value]) => op === "==" && data[field] === value
          )
      )
      .slice(0, query.max)
      .map(([path]) => makeSnapshot(path));
    return { empty: found.length === 0, size: found.length, docs: found };
  };
  const makeDoc = (path) => ({
    id: path.split("/").pop(),
    path,
    async get() {
      metrics.documentGets += 1;
      await wait("documentGet");
      return makeSnapshot(path);
    },
    async create(payload) {
      metrics.documentWrites += 1;
      await wait("documentWrite");
      if (docs.has(path)) throw new Error("ALREADY_EXISTS");
      docs.set(path, payload);
    },
    async set(payload, writeOptions) {
      metrics.documentWrites += 1;
      await wait("documentWrite");
      docs.set(
        path,
        writeOptions?.merge ? { ...(docs.get(path) || {}), ...payload } : payload
      );
    },
    async update(payload) {
      metrics.documentWrites += 1;
      await wait("documentWrite");
      if (!docs.has(path)) throw new Error("NOT_FOUND");
      docs.set(path, { ...docs.get(path), ...payload });
    },
  });
  const transaction = {
    async get(target) {
      return target._query ? querySnapshot(target) : makeSnapshot(target.path);
    },
    create(ref, payload) {
      if (docs.has(ref.path)) throw new Error("ALREADY_EXISTS");
      docs.set(ref.path, payload);
    },
    set(ref, payload, writeOptions) {
      docs.set(
        ref.path,
        writeOptions?.merge
          ? { ...(docs.get(ref.path) || {}), ...payload }
          : payload
      );
    },
    update(ref, payload) {
      if (!docs.has(ref.path)) throw new Error("NOT_FOUND");
      docs.set(ref.path, { ...docs.get(ref.path), ...payload });
    },
  };
  return {
    docs,
    metrics,
    collection(name) {
      const query = makeQuery(name);
      return {
        ...query,
        doc(id) {
          return makeDoc(`${name}/${id}`);
        },
      };
    },
    async getAll(...references) {
      metrics.batchGets += 1;
      metrics.batchDocuments += references.length;
      await wait("batchGet");
      return references.map((reference) => makeSnapshot(reference.path));
    },
    async runTransaction(callback) {
      return callback(transaction);
    },
  };
}
