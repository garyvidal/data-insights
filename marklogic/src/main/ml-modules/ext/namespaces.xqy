xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/namespaces";

declare namespace ca = "http://marklogic.com/content-analyzer";

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $analysis-id := map:get($params, "id")
    let $ns-string   := fn:string-join(
        for $ns in (/ca:content-analysis[ca:analysis-id = $analysis-id])/ca:namespaces/ca:namespace[. ne ""]
        where fn:not(fn:contains($ns/ca:namespace-uri/text(), "w3"))
        return ($ns/ca:prefix/text(), $ns/ca:namespace-uri/text()),
        ","
    )
    return
        document {
            <namespaces>{$ns-string}</namespaces>
        }
};
