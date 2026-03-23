xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/database-statistics";

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $db := map:get($params, "db")
    let $stmt :=
        '(
        xdmp:estimate(fn:collection()),
        xdmp:estimate(/element()),
        xdmp:estimate(/binary()),
        xdmp:estimate(/text()),
        xdmp:estimate(/(object-node()|array-node()))
        )'
    let $results := xdmp:eval($stmt, (), <options xmlns="xdmp:eval"><database>{xdmp:database($db)}</database></options>)
    return
        document {
            <statistics>
                <all-documents>{$results[1]}</all-documents>
                <xml-documents>{$results[2]}</xml-documents>
                <json-documents>{$results[5]}</json-documents>
                <binary-documents>{$results[3]}</binary-documents>
                <text-documents>{$results[4]}</text-documents>
            </statistics>
        }
};
