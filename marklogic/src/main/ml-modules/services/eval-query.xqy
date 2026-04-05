xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/eval-query";

import module namespace eval = "http://marklogic.com/eval" at "/lib/eval.xqy";

declare namespace ca = "http://marklogic.com/content-analyzer";

declare function post(
    $context as map:map,
    $params  as map:map,
    $input   as document-node()*
) as document-node()? {
    let $query  := xdmp:get-request-field("query")
    let $xpath  := xdmp:get-request-field("xpath", "fn:collection()")
    let $db     := xdmp:get-request-field("db")
    let $nses   := fn:string-join(/ca:namespace-list[ca:database = $db]/ca:namespace/(ca:prefix|ca:namespace-uri), "||")
    let $parsed :=
        try {
            (<count>{eval:estimate($query, $xpath, $nses, $db)}</count>, <valid>true</valid>)
        } catch ($ex) {
            (<valid>false</valid>, <error>{$ex}</error>)
        }
    return
        document { <message>{$parsed}</message> }
};
