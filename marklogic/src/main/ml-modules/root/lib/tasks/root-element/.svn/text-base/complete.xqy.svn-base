xquery version "1.0-ml";

declare variable $OUTPUT as map:map external;
declare variable $TASK-PROPERTIES as map:map external;
declare variable $REGEX := "^\{(.*)\}(\i\c*)$";

for $key in map:keys($OUTPUT)
let $namespace-uri := fn:replace($key,$REGEX,"$1")
let $local-name    := fn:replace($key,$REGEX,"$2")
let $hash := xdmp:md5($key)
let $database := map:get($TASK-PROPERTIES,"database")
return 
 xdmp:document-insert(
  fn:concat("/root-documents/",fn:concat($database),"/",$hash,".xml"),
  <root-element xmlns="http://marklogic.com/ca/analysis">
     <root-hash>{$hash}</root-hash>
     <database>{map:get($TASK-PROPERTIES,"database")}</database>
     <root-key>{$key}</root-key>
     <local-name>{$local-name}</local-name>
     <namespace-uri>{$namespace-uri}</namespace-uri>
     <documents>{fn:sum(map:get($OUTPUT,$key))}</documents>
  </root-element>
)

