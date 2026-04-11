xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/validate-query";

declare namespace ca = "http://marklogic.com/content-analyzer";

declare function post(
    $context as map:map,
    $params  as map:map,
    $input   as document-node()*
) as document-node()? {
    let $query := map:get($params,"constraint")
    let $xpath := map:get($params,"xpath")
    let $db    := map:get($params,"db")
    let $_ := xdmp:log(fn:concat("Validating query: ", $query, " with xpath: ", $xpath, " in db: ", $db))
    let $nses  := /ca:namespace-list[ca:database = $db]/ca:namespace/(ca:prefix|ca:namespace-uri)/fn:string(.)
    let $parsed :=
        try {
            let $expr := fn:concat('xdmp:with-namespaces(', xdmp:describe($nses, (), ()), ",", $query, ")")
            let $_ := xdmp:log($expr)
            let $ps         := xdmp:value($expr)
            let $xpath-value := xdmp:value(fn:concat('xdmp:with-namespaces(', xdmp:describe($nses, (), ()), ",(", $query, ")[1])"))
            let $valid      := $ps castable as cts:query
            return
                <response>
                    <valid>true</valid>
                    <message>Valid</message>
                </response>
        } catch ($ex) {
            <response>
                <valid>false</valid>
                <error>{fn:data($ex/error:format-string)}</error>
                <debug>{$ex}</debug>
            </response>
        }
    return
        document { <message>{$parsed}</message> }
};
