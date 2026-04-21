'use strict';
/**
 * normalizer.sjs
 * Converts MarkLogic documents (XML or JSON) into a uniform plain JS object
 * tree so the executor and planner can work with a single representation.
 *
 * Normalization rules
 * ───────────────────
 * JSON documents  → xdmp.jsonToXml() brings them into the XDM; we then walk
 *                   the object-node / array-node tree directly as JS values
 *                   via toObject() — the fastest path.
 *
 * XML documents   → xdmp.xmlToJson() + toObject() to get a JS plain object,
 *                   with attribute → "@attr" convention and text → "#text".
 *                   Alternatively we walk the element tree ourselves when we
 *                   need XPath-level control (used by the planner).
 *
 * The canonical internal form is a plain JS object whose shape mirrors the
 * GraphQL type's field names.  Field projection (picking only requested
 * fields) is performed by the executor on top of the normalized form.
 */

/**
 * documentToObject(doc)
 * Given a MarkLogic document node (JSON or XML), return a plain JS object.
 *
 * @param {Node} doc  - MarkLogic document-node()
 * @returns {Object}
 */
function documentToObject(doc) {
  if (!doc) return null;

  const docKind = xdmp.nodeKind(doc);

  // document-node(): dig into the root child to determine JSON vs XML
  if (docKind === 'document') {
    // doc.xpath('node()') returns the single root child of the document node
    const rootIter = doc.xpath('node()')[Symbol.iterator]();
    const rootNode = rootIter.next().value;
    if (!rootNode) return null;
    const rootKind = xdmp.nodeKind(rootNode);
    if (rootKind === 'object' || rootKind === 'array') {
      // JSON document: use native toObject() for correct primitive coercion
      return rootNode.toObject();
    }
    if (rootKind === 'element') {
      // XML document: walk via _xmlElementToObject so all keys use localName()
      // (no namespace prefix), which matches the sourceKey values in the schema
      return _xmlElementToObject(rootNode);
    }
    return null;
  }

  // Called directly with an object-node / array-node (JSON fragment)
  if (docKind === 'object' || docKind === 'array') {
    return doc.toObject();
  }

  // Called directly with an element node (XML fragment)
  if (docKind === 'element') {
    return _xmlElementToObject(doc);
  }

  // Fallback: attempt xdmp.xmlToJson (last resort — preserves namespace
  // prefixes in keys so only used when other paths are unavailable)
  try {
    const jsonNode = xdmp.xmlToJson(doc);
    return jsonNode ? jsonNode.toObject() : null;
  } catch (e) {
    return null;
  }
}


/**
 * _xmlElementToObject(element)
 * Convert an XML element tree to a plain JS object.
 *
 * Conventions:
 *   - attributes          → "@attributeName" keys
 *   - text-only element   → string value directly (or number/boolean if parseable)
 *   - mixed/complex       → object with children as keys
 *   - repeated child name → array
 */
function _xmlElementToObject(element) {
  const obj = {};

  // Collect attributes separately, then child elements via * (namespace-agnostic).
  // Using node() can miss elements in non-default namespaces without explicit bindings.
  const childArray = [];
  for (const attr of element.xpath('@*')) {
    obj[fn.localName(attr)] = _coerceScalar(fn.string(attr));
  }
  for (const child of element.xpath('*')) {
    childArray.push(child);
  }

  if (childArray.length === 0) {
    const text = fn.string(element).trim();
    if (Object.keys(obj).length === 0) return _coerceScalar(text);
    if (text) obj['#text'] = _coerceScalar(text);
    return obj;
  }

  // Count local-names to detect repeating siblings → array
  const nameCounts = {};
  for (const c of childArray) {
    const ln = fn.localName(c);
    nameCounts[ln] = (nameCounts[ln] || 0) + 1;
  }

  for (const c of childArray) {
    const ln  = fn.localName(c);
    const val = _xmlElementToObject(c);
    if (nameCounts[ln] > 1) {
      if (!Array.isArray(obj[ln])) obj[ln] = [];
      obj[ln].push(val);
    } else {
      obj[ln] = val;
    }
  }

  return obj;
}

/**
 * _coerceToFieldType(value, gqlType)
 * Coerce a scalar value to the declared GraphQL type.
 * Handles documents that store numbers or booleans as strings.
 */
function _coerceToFieldType(value, gqlType) {
  if (value === null || value === undefined) return value;
  const baseType = (gqlType || '').replace(/[\[\]!]/g, '');
  if (baseType === 'Int') {
    const n = parseInt(value, 10);
    return isNaN(n) ? value : n;
  }
  if (baseType === 'Float') {
    const n = parseFloat(value);
    return isNaN(n) ? value : n;
  }
  if (baseType === 'Boolean') {
    if (value === 'true')  return true;
    if (value === 'false') return false;
  }
  return value;
}

/**
 * _coerceScalar(text)
 * Try to return a typed JS value from a string.
 */
function _coerceScalar(text) {
  if (text === '')      return null;
  if (text === 'true')  return true;
  if (text === 'false') return false;
  const n = Number(text);
  if (!isNaN(n) && text.trim() !== '') return n;
  return text;
}

/**
 * projectObject(obj, selectionSet, schema, typeName, fragmentMap)
 * Walk a normalised JS object and return only the fields in the
 * GraphQL selection set.  Called by the executor after CTS search.
 *
 * @param {Object}       obj           - normalised document object
 * @param {SelectionSet} selectionSet  - AST SelectionSet node
 * @param {Object}       schema        - schema registry (from schema.sjs)
 * @param {string}       typeName      - current GraphQL type name
 * @param {Object}       fragmentMap   - named fragments from the parsed document
 * @returns {Object}
 */
function projectObject(obj, selectionSet, schema, typeName, fragmentMap) {
  if (!obj || !selectionSet) return obj;
  const result = {};
  const typeDef = schema.types[typeName] || {};
  const fields  = typeDef.fields || {};

  for (const sel of selectionSet.selections) {
    if (sel.kind === 'Field') {
      const fieldName  = sel.name;
      const alias      = sel.alias || fieldName;
      const fieldDef   = fields[fieldName] || {};
      const sourceKey  = fieldDef.sourceKey || fieldName;    // maps GraphQL name → doc key
      let   value      = _getNestedValue(obj, sourceKey);

      if (sel.selectionSet && value !== null && value !== undefined) {
        // Nested type
        const nestedType = _unwrapType(fieldDef.type);
        if (Array.isArray(value)) {
          value = value.map(item => projectObject(item, sel.selectionSet, schema, nestedType, fragmentMap));
        } else {
          value = projectObject(value, sel.selectionSet, schema, nestedType, fragmentMap);
        }
      }

      // Coerce scalars to the declared GraphQL type (handles docs that store
      // numbers as strings, which is common in MarkLogic JSON data)
      if (value !== null && value !== undefined && !sel.selectionSet) {
        value = _coerceToFieldType(value, fieldDef.type);
      }

      result[alias] = value !== undefined ? value : null;

    } else if (sel.kind === 'InlineFragment') {
      const nested = projectObject(obj, sel.selectionSet, schema, typeName, fragmentMap);
      Object.assign(result, nested);

    } else if (sel.kind === 'FragmentSpread') {
      const frag = fragmentMap[sel.name];
      if (frag) {
        const nested = projectObject(obj, frag.selectionSet, schema, typeName, fragmentMap);
        Object.assign(result, nested);
      }
    }
  }
  return result;
}

/**
 * _getNestedValue(obj, dotPath)
 * Resolve a dot-separated path like "address.city" into obj.
 */
function _getNestedValue(obj, dotPath) {
  if (!dotPath || obj === null || obj === undefined) return undefined;
  const parts = dotPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * _unwrapType(typeStr)
 * Strip List/NonNull wrappers: "[Order!]!" → "Order"
 */
function _unwrapType(typeStr) {
  if (!typeStr) return 'String';
  return typeStr.replace(/[\[\]!]/g, '');
}

/**
 * xmlDocToXPath(doc, xpathExpr, namespaces)
 * Evaluate an XPath against an XML document node, returning a JS array of
 * normalised values.  Used by the executor for XML field resolution.
 *
 * @param {Node}   doc        - MarkLogic document node
 * @param {string} xpathExpr  - XPath expression
 * @param {Object} namespaces - prefix → URI map
 * @returns {Array}
 */
function xmlDocToXPath(doc, xpathExpr, namespaces) {
  const nsBindings = [];
  if (namespaces) {
    for (const [prefix, uri] of Object.entries(namespaces)) {
      nsBindings.push(prefix, uri);
    }
  }
  const results = xdmp.withNamespaces(nsBindings, () => doc.xpath(xpathExpr));
  const out = [];
  for (const r of results) {
    const kind = xdmp.nodeKind(r);
    if (kind === 'element') {
      out.push(_xmlElementToObject(r));
    } else {
      out.push(_coerceScalar(fn.string(r)));
    }
  }
  return out.length === 1 ? out[0] : out;
}

module.exports = { documentToObject, projectObject, xmlDocToXPath };
