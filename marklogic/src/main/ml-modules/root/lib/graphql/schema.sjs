'use strict';
/**
 * schema.sjs
 * Schema registry for the GraphQL engine.
 *
 * Two sources of truth:
 *
 * 1. Hand-authored schema documents stored in MarkLogic at
 *    /graphql/schema/{TypeName}.json
 *
 * 2. Auto-derived schemas generated from analyze-documents.xqy output
 *    stored at /analysis/results/{ticket}.xml  (the <analysis> elements
 *    produced by the task runner).
 *
 * The registry merges both, with hand-authored definitions taking precedence.
 *
 * ─── Stored schema document format (/graphql/schema/Order.json) ────────────
 * {
 *   "type":       "Order",
 *   "collection": "orders",
 *   "format":     "json",          // "json" | "xml"
 *   "namespaces": { "o": "http://example.com/orders" },  // XML only
 *   "fields": {
 *     "id":       { "type": "ID",     "sourceKey": "id",          "index": "value" },
 *     "status":   { "type": "String", "sourceKey": "status",      "index": "value" },
 *     "amount":   { "type": "Float",  "sourceKey": "amount",      "index": "range" },
 *     "placedAt": { "type": "String", "sourceKey": "placedAt",    "index": "range" },
 *     "items":    { "type": "[LineItem]", "sourceKey": "items",   "embedded": true }
 *   },
 *   "relations": {
 *     "customer": { "type": "Customer", "via": "customerId", "foreignKey": "id" }
 *   }
 * }
 *
 * ─── Analysis XML element structure (from analyze-documents.xqy) ───────────
 * <analysis xmlns="http://marklogic.com/content-analyzer">
 *   <elements>
 *     <element>
 *       <localname>status</localname>
 *       <namespace/>
 *       <infered-types>xs:string</infered-types>
 *       <node-kind>         <!-- object-node | array-node | "" -->
 *       <frequency>42</frequency>
 *       <xpaths><xpath><xpath-uri>/status</xpath-uri></xpath></xpaths>
 *     </element>
 *     ...
 *   </elements>
 *   <element-elements>   <!-- parent-child relationships -->
 *     <element-element>
 *       <parent-localname>order</parent-localname>
 *       <child-localname>status</child-localname>
 *       <infered-types>xs:string</infered-types>
 *     </element-element>
 *   </element-elements>
 * </analysis>
 */

const SCHEMA_PREFIX = '/graphql/schema/';
const ANALYSIS_NS   = 'http://marklogic.com/content-analyzer';

// ---------------------------------------------------------------------------
// Type mapping: MarkLogic inferred type → GraphQL scalar
// ---------------------------------------------------------------------------
const ML_TYPE_TO_GQL = {
  'xs:string':          'String',
  'xs:integer':         'Int',
  'xs:long':            'Int',
  'xs:float':           'Float',
  'xs:double':          'Float',
  'xs:decimal':         'Float',
  'xs:unsignedLong':    'Int',
  'xs:unsignedInteger': 'Int',
  'xs:boolean':         'Boolean',
  'xs:date':            'String',
  'xs:dateTime':        'String',
  'xs:time':            'String',
  'xs:duration':        'String',
  'sql:dateTime':       'String',
  'sql:shortTime':      'String',
  'xs:complexType':     null,   // signals a nested object
  '##MIXED##':          'String',
  'xsi:nilled':         'String',
};

// ---------------------------------------------------------------------------
// Load a single hand-authored schema document from MarkLogic
// ---------------------------------------------------------------------------
function _loadStoredSchema(typeName) {
  const uri = SCHEMA_PREFIX + typeName + '.json';
  const doc = cts.doc(uri);
  if (!doc) return null;
  return doc.toObject();
}

// ---------------------------------------------------------------------------
// List all stored schema documents
// ---------------------------------------------------------------------------
function _listStoredTypes() {
  const types = {};
  for (const uri of cts.uris(SCHEMA_PREFIX, ['document'])) {
    const uriStr = String(uri);
    if (!uriStr.startsWith(SCHEMA_PREFIX)) break;
    try {
      const doc = cts.doc(uri).toObject();
      if (doc && doc.type) {
        types[doc.type] = doc;
      }
    } catch (e) {
      // skip malformed
    }
  }
  return types;
}

// ---------------------------------------------------------------------------
// Derive a GraphQL type definition from an analysis XML document
// ---------------------------------------------------------------------------
/**
 * deriveFromAnalysis(analysisDoc, options)
 *
 * @param {Node}   analysisDoc  - MarkLogic XML document-node for an analysis result
 * @param {Object} options
 *   @param {string} options.typeName   - GraphQL type name to generate (e.g. "Order")
 *   @param {string} options.collection - MarkLogic collection the docs come from
 *   @param {string} options.format     - "json" | "xml"
 *   @param {string} [options.rootElement] - for XML: local name of root element to scope to
 * @returns {Object}  schema definition object (same shape as stored schema)
 */
function deriveFromAnalysis(analysisDoc, options) {
  const typeName   = options.typeName;
  const collection = options.collection;
  const format     = options.format || 'json';

  const ns = ANALYSIS_NS;

  // Collect all <element> nodes from the analysis
  const elementNodes = analysisDoc.xpath(`//*[fn:namespace-uri(.) = "${ns}"][fn:local-name(.) = "element"]`);

  // Build a parent→children map and a child→inferredType map from <element-element> nodes.
  // NOTE: for XML leaf elements, the analysis engine stores actual values under the
  // parent-child compound key (not the element's own key), so <element> nodes for leaf
  // fields will have <infered-types>xsi:nilled</infered-types>. The correct inferred type
  // lives only in the corresponding <element-element> record. We collect it here and use
  // it as a fallback when the <element>-level type is empty / xsi:nilled.
  const parentChildMap = {};
  const childTypeMap   = {};   // childLocalname → best inferred type seen across all parent-child records
  const eeNodes = analysisDoc.xpath(`//*[fn:namespace-uri(.) = "${ns}"][fn:local-name(.) = "element-element"]`);
  for (const ee of eeNodes) {
    const parentName = fn.string(ee.xpath(`*[fn:local-name(.) = "parent-localname"]`)[Symbol.iterator]().next().value || '');
    const childName  = fn.string(ee.xpath(`*[fn:local-name(.) = "child-localname"]`)[Symbol.iterator]().next().value || '');
    const eeType     = fn.string(ee.xpath(`*[fn:local-name(.) = "infered-types"]`)[Symbol.iterator]().next().value || '');
    if (parentName && childName) {
      if (!parentChildMap[parentName]) parentChildMap[parentName] = new Set();
      parentChildMap[parentName].add(childName);
      // Keep the most specific type we've seen for this child (prefer integer/decimal/float over xsi:nilled/string)
      if (eeType && eeType !== 'xsi:nilled' && eeType !== '') {
        if (!childTypeMap[childName] || childTypeMap[childName] === 'xs:string') {
          childTypeMap[childName] = eeType;
        }
      }
    }
  }

  // Pass 1: collect raw metadata for every element node, keyed by localname.
  // We need all elements in hand before we can decide which belong to the root
  // type vs. which belong to a nested type.
  const elementMeta = {};   // localname → { inferType, nodeKind, frequency, xpath }
  for (const el of elementNodes) {
    const localname = _text(el, 'localname');
    if (!localname || elementMeta[localname]) continue;
    const xpathNode = el.xpath(`*[fn:local-name(.) = "xpaths"]/*[fn:local-name(.) = "xpath"]/*[fn:local-name(.) = "xpath-uri"]`)[Symbol.iterator]().next().value;
    elementMeta[localname] = {
      inferType: _text(el, 'infered-types'),
      nodeKind:  _text(el, 'node-kind'),
      frequency: parseInt(_text(el, 'frequency') || '0', 10),
      xpath:     xpathNode ? fn.string(xpathNode) : ('/' + localname),
    };
  }

  // Determine which localnames are nested-type containers (have children in the
  // parentChildMap).  Their children should NOT appear as flat fields on the
  // root type; instead they become fields on the nested type.
  const nestedTypeOwners = new Set();   // localnames that own a nested type
  for (const [owner] of Object.entries(parentChildMap)) {
    if (parentChildMap[owner] && parentChildMap[owner].size > 0) {
      // owner is a nested-type container — track it
      nestedTypeOwners.add(owner);
    }
  }

  // Build a reverse map: childLocalname → Set of parent localnames that own it
  const childOwnedBy = {};
  for (const [owner, childSet] of Object.entries(parentChildMap)) {
    if (!nestedTypeOwners.has(owner)) continue;   // only nested owners
    for (const child of childSet) {
      if (!childOwnedBy[child]) childOwnedBy[child] = new Set();
      childOwnedBy[child].add(owner);
    }
  }

  // Helper: derive a field definition object from element metadata
  function _makeFieldDef(localname, meta, ownerLocalname) {
    const inferType = meta.inferType;
    const resolvedType = (inferType && inferType !== 'xsi:nilled')
      ? inferType
      : (childTypeMap[localname] || inferType);

    const isObject = meta.nodeKind === 'object-node' || resolvedType === 'xs:complexType';
    const isArray  = meta.nodeKind === 'array-node';
    const children = parentChildMap[localname];

    let gqlType;
    if (isArray && children && children.size > 0) {
      gqlType = `[${_toTypeName(localname)}]`;
    } else if (isObject || (children && children.size > 0)) {
      gqlType = _toTypeName(localname);
    } else {
      gqlType = ML_TYPE_TO_GQL[resolvedType] || 'String';
    }

    let index = null;
    if (gqlType === 'String' || gqlType === 'ID') index = 'value';
    if (gqlType === 'Int'    || gqlType === 'Float') index = 'range';
    if (gqlType === 'Boolean') index = 'value';

    // sourceKey is relative to the ownerLocalname's object (not the document root)
    let sourceKey = localname;
    if (format === 'xml' && meta.xpath && meta.xpath.startsWith('/') && ownerLocalname) {
      // Strip xpath segments up to and including the owner element, then take the rest
      const parts = meta.xpath.split('/').filter(p => p).map(p => {
        const ci = p.indexOf(':'); return ci >= 0 ? p.substring(ci + 1) : p;
      });
      const ownerIdx = parts.lastIndexOf(ownerLocalname);
      sourceKey = ownerIdx >= 0 ? parts.slice(ownerIdx + 1).join('.') : localname;
    }

    return { type: gqlType, sourceKey, xpath: meta.xpath, index, frequency: meta.frequency };
  }

  // The root element local-name (xpath depth = 1) should never appear as a field
  // or a nested type — it is the document wrapper that gets unwrapped by the executor.
  const rootLocalName = options.rootElement ||
    Object.keys(elementMeta).find(ln => {
      const depth = elementMeta[ln].xpath.split('/').filter(p => p).length;
      return depth === 1;
    });

  // Pass 2: build root-type fields (skip children that belong to a nested owner)
  const fields = {};
  for (const [localname, meta] of Object.entries(elementMeta)) {
    // Skip the root element itself
    const pathDepth = meta.xpath.split('/').filter(p => p).length;
    if (pathDepth === 1) continue;

    // Skip elements owned exclusively by a nested type (depth > 2 from document root)
    const owners = childOwnedBy[localname];
    if (owners && owners.size > 0 && pathDepth > 2) continue;

    fields[_toCamelCase(localname)] = _makeFieldDef(localname, meta, null);

    // For XML, fix the root-level sourceKey using the xpath (same as before)
    if (format === 'xml' && meta.xpath && meta.xpath.startsWith('/')) {
      fields[_toCamelCase(localname)].sourceKey = _xpathToSourceKey(meta.xpath, typeName);
    }
  }

  // Pass 3: build nested type definitions for every nested-type owner
  const nestedTypes = {};
  for (const ownerLocalname of nestedTypeOwners) {
    // Skip the root element — it is the document itself, not a nested type
    if (ownerLocalname === rootLocalName) continue;
    const nestedTypeName = _toTypeName(ownerLocalname);
    const childSet = parentChildMap[ownerLocalname];
    const nestedFields = {};
    for (const childName of childSet) {
      const meta = elementMeta[childName];
      if (!meta) continue;
      nestedFields[_toCamelCase(childName)] = _makeFieldDef(childName, meta, ownerLocalname);
    }
    nestedTypes[nestedTypeName] = {
      type:       nestedTypeName,
      collection,
      format,
      fields:     nestedFields,
      relations:  {},
      derived:    true,
      nestedUnder: typeName,
    };
  }

  return {
    type: typeName,
    collection,
    format,
    fields,
    relations: {},
    derived: true,
    nestedTypes,
  };
}

// ---------------------------------------------------------------------------
// Build the full schema registry
// ---------------------------------------------------------------------------
/**
 * loadRegistry()
 * Returns the merged schema registry:
 * {
 *   types: { TypeName: { type, collection, format, fields, relations } },
 *   queryFields: { fieldName: { type, collection, ... } }   // root Query fields
 * }
 */
function loadRegistry() {
  xdmp.log('[schema] loadRegistry() start', 'debug');
  const stored = _listStoredTypes();
  xdmp.log('[schema] stored schema types: ' + JSON.stringify(Object.keys(stored)), 'debug');

  // Also discover analysis-derived schemas from stored derivation hints
  // Derivation hints live at /graphql/derive/{TypeName}.json with shape:
  //   { typeName, collection, format, analysisUri, rootElement? }
  const derived = {};
  const derivePrefix = '/graphql/derive/';
  const deriveQuery = cts.andQuery([
    cts.directoryQuery(derivePrefix,"1")
  ]);
  const deriveUris = [];
  for (const uri of cts.uris(derivePrefix, ['document'],deriveQuery)) {
    const uriStr = String(uri);
    if (!uriStr.startsWith(derivePrefix)) break;
    deriveUris.push(uriStr);
    try {
      const hint = cts.doc(uri).toObject();
      // Hint doc IS the full schema definition — no analysis re-read needed
      if (!hint || !hint.type) {
        xdmp.log('[schema] skipping derive hint at ' + uri + ' — missing type field (may need re-derive)', 'warning');
        continue;
      }
      if (!stored[hint.type]) {
        derived[hint.type] = hint;
        xdmp.log('[schema] loaded derived type: ' + hint.type + ' (' + Object.keys(hint.fields || {}).length + ' fields)', 'debug');
        // Register any nested types that were derived alongside the root type
        for (const [nestedName, nestedDef] of Object.entries(hint.nestedTypes || {})) {
          if (!stored[nestedName] && !derived[nestedName]) {
            derived[nestedName] = nestedDef;
            xdmp.log('[schema] loaded nested derived type: ' + nestedName + ' (' + Object.keys(nestedDef.fields || {}).length + ' fields)', 'debug');
          }
        }
      } else {
        xdmp.log('[schema] skipping derived type ' + hint.type + ' — overridden by stored schema', 'debug');
      }
    } catch (e) {
      xdmp.log('[schema] error processing derive hint ' + uri + ': ' + e.message, 'error');
    }
  }
  xdmp.log('[schema] derive hint URIs found: ' + JSON.stringify(deriveUris), 'debug');

  const types = Object.assign({}, derived, stored);
  xdmp.log('[schema] total types in registry: ' + JSON.stringify(Object.keys(types)), 'debug');

  // Build root Query fields: one field per type (plural, camelCase)
  const queryFields = {};
  for (const [typeName, typeDef] of Object.entries(types)) {
    const fieldName = _toCamelCase(typeName) + 's'; // Order → orders
    queryFields[fieldName] = {
      type:       `[${typeName}]`,
      collection: typeDef.collection,
      format:     typeDef.format || 'json',
    };
    // Also allow singular by typeName (camelCase)
    queryFields[_toCamelCase(typeName)] = {
      type:       typeName,
      collection: typeDef.collection,
      format:     typeDef.format || 'json',
    };
  }
  xdmp.log('[schema] queryFields available: ' + JSON.stringify(Object.keys(queryFields)), 'debug');

  return { types, queryFields };
}

// ---------------------------------------------------------------------------
// Introspection schema builder
// ---------------------------------------------------------------------------
/**
 * buildIntrospectionSchema(registry)
 * Builds the __Schema object required for GraphQL introspection.
 * Covers __schema, __type, __Field, __InputValue, __EnumValue, __TypeKind.
 */
function buildIntrospectionSchema(registry) {
  const { types } = registry;

  const builtinScalars = ['String', 'Int', 'Float', 'Boolean', 'ID'];

  // Collect all GraphQL types referenced
  const allTypes = {};

  // Add scalars
  for (const s of builtinScalars) {
    allTypes[s] = { kind: 'SCALAR', name: s, description: null, fields: null, inputFields: null, interfaces: [], enumValues: null, possibleTypes: null, ofType: null };
  }

  // Add Query type
  const queryFields = [];
  for (const [fieldName, fieldDef] of Object.entries(registry.queryFields)) {
    queryFields.push(_introspectField(fieldName, fieldDef.type, []));
  }
  allTypes['Query'] = { kind:'OBJECT', name:'Query', description:'Root query type', fields: queryFields, inputFields:null, interfaces:[], enumValues:null, possibleTypes:null, ofType:null };

  // Add object types from registry
  for (const [typeName, typeDef] of Object.entries(types)) {
    const iFields = [];
    for (const [fieldName, fieldDef] of Object.entries(typeDef.fields || {})) {
      iFields.push(_introspectField(fieldName, fieldDef.type, []));
    }
    allTypes[typeName] = { kind:'OBJECT', name:typeName, description: typeDef.description || null, fields: iFields, inputFields:null, interfaces:[], enumValues:null, possibleTypes:null, ofType:null };
  }

  // Add built-in introspection types
  _addIntrospectionMetaTypes(allTypes);

  return {
    queryType: { name: 'Query' },
    mutationType: null,
    subscriptionType: null,
    types: Object.values(allTypes),
    directives: [
      { name:'skip',    locations:['FIELD','FRAGMENT_SPREAD','INLINE_FRAGMENT'], args:[ {name:'if', type:{kind:'NON_NULL',ofType:{kind:'SCALAR',name:'Boolean'}}, defaultValue:null} ] },
      { name:'include', locations:['FIELD','FRAGMENT_SPREAD','INLINE_FRAGMENT'], args:[ {name:'if', type:{kind:'NON_NULL',ofType:{kind:'SCALAR',name:'Boolean'}}, defaultValue:null} ] },
      { name:'deprecated', locations:['FIELD_DEFINITION','ENUM_VALUE'], args:[ {name:'reason', type:{kind:'SCALAR',name:'String'}, defaultValue:'No longer supported'} ] },
    ]
  };
}

function _introspectField(name, typeStr, args) {
  return {
    name,
    description: null,
    args: args || [],
    type: _typeRefFromString(typeStr),
    isDeprecated: false,
    deprecationReason: null,
  };
}

function _typeRefFromString(typeStr) {
  if (!typeStr) return { kind:'SCALAR', name:'String', ofType:null };
  // NonNull wrapper
  if (typeStr.endsWith('!')) {
    return { kind:'NON_NULL', name:null, ofType: _typeRefFromString(typeStr.slice(0,-1)) };
  }
  // List wrapper
  if (typeStr.startsWith('[') && typeStr.endsWith(']')) {
    return { kind:'LIST', name:null, ofType: _typeRefFromString(typeStr.slice(1,-1)) };
  }
  const scalars = ['String','Int','Float','Boolean','ID'];
  if (scalars.includes(typeStr)) {
    return { kind:'SCALAR', name:typeStr, ofType:null };
  }
  return { kind:'OBJECT', name:typeStr, ofType:null };
}

function _addIntrospectionMetaTypes(allTypes) {
  // __TypeKind enum
  allTypes['__TypeKind'] = {
    kind:'ENUM', name:'__TypeKind', description:'An enum describing what kind of type a given `__Type` is.',
    fields:null, inputFields:null, interfaces:[], possibleTypes:null, ofType:null,
    enumValues: ['SCALAR','OBJECT','INTERFACE','UNION','ENUM','INPUT_OBJECT','LIST','NON_NULL'].map(v => ({name:v, isDeprecated:false, deprecationReason:null, description:null}))
  };
  allTypes['__Schema'] = { kind:'OBJECT', name:'__Schema', description:'A GraphQL Schema.', fields:[
    {name:'types', type:{kind:'NON_NULL',ofType:{kind:'LIST',ofType:{kind:'OBJECT',name:'__Type'}}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'queryType', type:{kind:'NON_NULL',ofType:{kind:'OBJECT',name:'__Type'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'mutationType', type:{kind:'OBJECT',name:'__Type'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'directives', type:{kind:'NON_NULL',ofType:{kind:'LIST',ofType:{kind:'OBJECT',name:'__Directive'}}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
  ], inputFields:null, interfaces:[], enumValues:null, possibleTypes:null, ofType:null };
  allTypes['__Type'] = { kind:'OBJECT', name:'__Type', description:'A single type in the schema.', fields:[
    {name:'kind',        type:{kind:'NON_NULL',ofType:{kind:'ENUM',name:'__TypeKind'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'name',        type:{kind:'SCALAR',name:'String'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'description', type:{kind:'SCALAR',name:'String'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'fields',      type:{kind:'LIST',ofType:{kind:'OBJECT',name:'__Field'}},  args:[{name:'includeDeprecated',type:{kind:'SCALAR',name:'Boolean'},defaultValue:false}], isDeprecated:false, deprecationReason:null, description:null},
    {name:'interfaces',  type:{kind:'LIST',ofType:{kind:'OBJECT',name:'__Type'}},   args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'possibleTypes',type:{kind:'LIST',ofType:{kind:'OBJECT',name:'__Type'}},  args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'enumValues',  type:{kind:'LIST',ofType:{kind:'OBJECT',name:'__EnumValue'}}, args:[{name:'includeDeprecated',type:{kind:'SCALAR',name:'Boolean'},defaultValue:false}], isDeprecated:false, deprecationReason:null, description:null},
    {name:'inputFields', type:{kind:'LIST',ofType:{kind:'OBJECT',name:'__InputValue'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'ofType',      type:{kind:'OBJECT',name:'__Type'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
  ], inputFields:null, interfaces:[], enumValues:null, possibleTypes:null, ofType:null };
  allTypes['__Field'] = { kind:'OBJECT', name:'__Field', fields:[
    {name:'name',              type:{kind:'NON_NULL',ofType:{kind:'SCALAR',name:'String'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'description',       type:{kind:'SCALAR',name:'String'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'args',              type:{kind:'NON_NULL',ofType:{kind:'LIST',ofType:{kind:'OBJECT',name:'__InputValue'}}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'type',              type:{kind:'NON_NULL',ofType:{kind:'OBJECT',name:'__Type'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'isDeprecated',      type:{kind:'NON_NULL',ofType:{kind:'SCALAR',name:'Boolean'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'deprecationReason', type:{kind:'SCALAR',name:'String'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
  ], inputFields:null, interfaces:[], enumValues:null, possibleTypes:null, ofType:null, description:null };
  allTypes['__InputValue'] = { kind:'OBJECT', name:'__InputValue', fields:[
    {name:'name',         type:{kind:'NON_NULL',ofType:{kind:'SCALAR',name:'String'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'description',  type:{kind:'SCALAR',name:'String'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'type',         type:{kind:'NON_NULL',ofType:{kind:'OBJECT',name:'__Type'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'defaultValue', type:{kind:'SCALAR',name:'String'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
  ], inputFields:null, interfaces:[], enumValues:null, possibleTypes:null, ofType:null, description:null };
  allTypes['__EnumValue'] = { kind:'OBJECT', name:'__EnumValue', fields:[
    {name:'name',              type:{kind:'NON_NULL',ofType:{kind:'SCALAR',name:'String'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'description',       type:{kind:'SCALAR',name:'String'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'isDeprecated',      type:{kind:'NON_NULL',ofType:{kind:'SCALAR',name:'Boolean'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'deprecationReason', type:{kind:'SCALAR',name:'String'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
  ], inputFields:null, interfaces:[], enumValues:null, possibleTypes:null, ofType:null, description:null };
  allTypes['__Directive'] = { kind:'OBJECT', name:'__Directive', fields:[
    {name:'name',        type:{kind:'NON_NULL',ofType:{kind:'SCALAR',name:'String'}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'description', type:{kind:'SCALAR',name:'String'}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'locations',   type:{kind:'NON_NULL',ofType:{kind:'LIST',ofType:{kind:'SCALAR',name:'String'}}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
    {name:'args',        type:{kind:'NON_NULL',ofType:{kind:'LIST',ofType:{kind:'OBJECT',name:'__InputValue'}}}, args:[], isDeprecated:false, deprecationReason:null, description:null},
  ], inputFields:null, interfaces:[], enumValues:null, possibleTypes:null, ofType:null, description:null };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _text(node, localname) {
  const child = node.xpath(`*[fn:local-name(.) = "${localname}"]`)[Symbol.iterator]().next().value;
  return child ? fn.string(child).trim() : '';
}

function _toCamelCase(str) {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function _toTypeName(str) {
  // "order-item" → "OrderItem"
  return str.split(/[-_ ]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/**
 * _xpathToSourceKey(xpath, rootTypeName)
 * Convert an XPath like "/ns0:orders/c:customers/c:address" to a sourceKey
 * for navigating the normalized object structure: "customers.address"
 *
 * For XML documents, after normalization and root unwrapping, nested fields
 * need dot-separated paths to match the object structure.
 *
 * @param {string} xpath        - Full xpath from analysis (e.g. "/ns0:orders/c:customers/c:address")
 * @param {string} rootTypeName - GraphQL type name (e.g. "Order", "Orders")
 * @returns {string}            - Dot-separated sourceKey (e.g. "customers.address")
 */
function _xpathToSourceKey(xpath, rootTypeName) {
  // Split by / and filter out empty strings
  const parts = xpath.split('/').filter(p => p);
  
  // Strip namespace prefixes (e.g. "ns0:orders" → "orders")
  const localNames = parts.map(p => {
    const colonIndex = p.indexOf(':');
    return colonIndex >= 0 ? p.substring(colonIndex + 1) : p;
  });

  if (localNames.length === 0) return '';

  // Remove the root element (first part) - it matches the wrapper that gets unwrapped
  // For "/ns0:orders/ns0:employeeId", this gives us ["employeeId"]
  // For "/ns0:orders/c:customers/c:address", this gives us ["customers", "address"]
  const pathParts = localNames.slice(1);

  // Join with dots for nested navigation
  return pathParts.join('.');
}

module.exports = { loadRegistry, deriveFromAnalysis, buildIntrospectionSchema, ML_TYPE_TO_GQL };
