xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/analysis-status";

declare namespace ca = "http://marklogic.com/content-analyzer";

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $db := map:get($params, "db")
    let $results :=
        (
            xdmp:estimate(cts:search(/ca:content-analysis, cts:element-value-query(xs:QName("ca:database"), $db))),
            xdmp:estimate(cts:search(/ca:ticket, cts:element-value-query(xs:QName("ca:database"), $db)))
        )
    return
        document {
            <status>
                <analyzed>{$results[1]}</analyzed>
                <running>{$results[2]}</running>
            </status>
        }
};
