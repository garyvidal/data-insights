xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/eval-xpath";

import module namespace eval = "http://marklogic.com/eval" at "/lib/eval.xqy";

declare namespace ca = "http://marklogic.com/content-analyzer";

(:~
 : Execute an XPath expression scoped by an optional cts:query constraint,
 : returning paginated results plus an estimate count.
 :
 : Parameters (form fields):
 :   query     – cts:query string, e.g. cts:and-query(())
 :   xpath     – XPath scope, e.g. fn:collection() or /root/child
 :   db        – target database name
 :   analysis-id – (optional) analysis id to resolve namespace context
 :   page      – 1-based page number (default 1)
 :   pageSize  – results per page (default 25)
 :)
declare function post(
    $context as map:map,
    $params  as map:map,
    $input   as document-node()*
) as document-node()? {
    let $query       := map:get($params,"query")
    let $xpath       := map:get($params,"xpath")
    let $db          := map:get($params,"db")
    let $analysis-id := map:get($params,"analysis-id")
    let $page        := xs:integer(map:get($params,"page"))
    let $page-size   := xs:integer(map:get($params,"pageSize"))
    let $start       := (($page - 1) * $page-size) + 1
    let $end         := $page * $page-size

    (: Resolve namespace context from analysis or database-level namespace list :)
    let $ns-seq :=
        if ($analysis-id ne "")
        then /ca:content-analysis[ca:analysis-id = $analysis-id]
             /ca:namespaces/ca:namespace[ca:prefix ne "*"
                and fn:not(fn:empty(ca:namespace-uri))
                and fn:not(ca:prefix = ("xml","xsi","xs"))]
             /(ca:prefix|ca:namespace-uri)/fn:string(.)
        else /ca:namespace-list[ca:database = $db]
             /ca:namespace[ca:prefix ne "*"]
             /(ca:prefix|ca:namespace-uri)/fn:string(.)

    let $ns-decls :=
        fn:string-join(
            for $set at $pos in $ns-seq
            return
                if ($pos mod 2 = 0 and $ns-seq[$pos - 1] ne "*")
                then fn:concat("declare namespace ", $ns-seq[$pos - 1], " = '", $set, "';")
                else ()
        , " ")

    let $parsed :=
        try {
            let $stmt-estimate := fn:concat(
                'xquery version "1.0-ml"; ', $ns-decls,
                ' declare variable $query as xs:string external;',
                ' xdmp:with-namespaces((),',
                '   xdmp:estimate(cts:search(', $xpath, ', xdmp:value($query))))'
            )
            let $estimate := xdmp:eval(
                $stmt-estimate,
                (xs:QName("query"), $query),
                <options xmlns="xdmp:eval">
                    <database>{xdmp:database($db)}</database>
                </options>
            )

            let $stmt-results := fn:concat(
                'xquery version "1.0-ml"; ', $ns-decls,
                ' declare variable $query as xs:string external;',
                ' declare variable $start as xs:integer external;',
                ' declare variable $end   as xs:integer external;',
                ' xdmp:with-namespaces((),',
                '   cts:search(', $xpath, ', xdmp:value($query))[$start to $end])'
            )
            let $results := xdmp:eval(
                $stmt-results,
                (xs:QName("query"), $query,
                 xs:QName("start"), $start,
                 xs:QName("end"),   $end),
                <options xmlns="xdmp:eval">
                    <database>{xdmp:database($db)}</database>
                </options>
            )

            return
                <response>
                    <valid>true</valid>
                    <estimate>{$estimate}</estimate>
                    <page>{$page}</page>
                    <pageSize>{$page-size}</pageSize>
                    <results>{
                        for $r in $results
                        return <result uri="{xdmp:node-uri($r)}" type="{xdmp:node-kind($r)}">{
                            if ($r instance of document-node())
                            then xdmp:quote($r/node()[1])
                            else xdmp:quote($r)
                        }</result>
                    }</results>
                </response>
        } catch ($ex) {
            <response>
                <valid>false</valid>
                <error>{fn:data($ex/error:format-string)}</error>
            </response>
        }

    return document { $parsed }
};
