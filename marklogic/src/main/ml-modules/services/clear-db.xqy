xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/clear-db";

declare namespace ca = "http://marklogic.com/content-analyzer";

declare function delete(
    $context as map:map,
    $params  as map:map
) as document-node()? {
    let $db   := map:get($params, "db")
    let $uris :=
        cts:uris((), (),
            cts:and-query((
                cts:element-value-query(xs:QName("ca:database"), $db),
                cts:not-query(cts:element-query(xs:QName("ca:namespace-list"), cts:and-query(())))
            ))
        )
    let $_ := for $uri in $uris return xdmp:document-delete($uri)
    return ()
};
