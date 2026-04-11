xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/search";

import module namespace search = "http://marklogic.com/appservices/search"
    at "/MarkLogic/appservices/search/search.xqy";

declare namespace ca  = "http://marklogic.com/content-analyzer";
declare namespace s   = "http://marklogic.com/appservices/search";

(:~
 : Execute a search using a named search option set.
 :
 : POST body fields:
 :   db         – target database
 :   options-id – id of a saved search-options document
 :   query      – query string (passed to search:search)
 :   page       – 1-based page (default 1)
 :   pageSize   – results per page (default 25)
 :)
declare function post(
    $context as map:map,
    $params  as map:map,
    $input   as document-node()*
) as document-node()? {
    let $db         := map:get($params, "db")
    let $options-id := map:get($params, "options-id")
    let $query-str  := map:get($params, "query")
    let $page       := xs:integer((map:get($params, "page"),       "1")[1])
    let $page-size  := xs:integer((map:get($params, "pageSize"),  "25")[1])
    let $start      := (($page - 1) * $page-size) + 1

    let $opts-doc := cts:search(/,
        cts:and-query((
            cts:collection-query("search-options"),
            cts:json-property-value-query("id", $options-id)
        )))[1]

    return
        if (fn:empty($opts-doc)) then
            document {
                object-node {
                    "valid": false(),
                    "error": "Search options not found"
                }
            }
        else
            let $constraints := $opts-doc/options/constraints
            let $search-opts := resource:build-options($constraints, $opts-doc/options)

            let $parsed :=
                try {
                    let $results := xdmp:eval(
                        'xquery version "1.0-ml";
                         import module namespace search = "http://marklogic.com/appservices/search"
                             at "/MarkLogic/appservices/search/search.xqy";
                         declare variable $query-str  as xs:string  external;
                         declare variable $start      as xs:integer external;
                         declare variable $page-size  as xs:integer external;
                         declare variable $search-opts as element() external;
                         search:search($query-str, $search-opts, $start, $page-size)',
                        (xs:QName("query-str"),   $query-str,
                         xs:QName("start"),       $start,
                         xs:QName("page-size"),   $page-size,
                         xs:QName("search-opts"), $search-opts),
                        <options xmlns="xdmp:eval">
                            <database>{xdmp:database($db)}</database>
                        </options>
                    )
                    let $total    := xs:integer(($results/@total, 0)[1])
                    let $estimate := $total
                    return
                        <response>
                            <valid>true</valid>
                            <estimate>{$estimate}</estimate>
                            <page>{$page}</page>
                            <pageSize>{$page-size}</pageSize>
                            <facets>{
                                for $f in $results/s:facet
                                return
                                    <facet name="{fn:string($f/@name)}">{
                                        for $fv in $f/s:facet-value
                                        return
                                            <value name="{fn:string($fv/@name)}" count="{fn:string($fv/@count)}"/>
                                    }</facet>
                            }</facets>
                            <results>{
                                for $r in $results/s:result
                                let $uri  := fn:string($r/@uri)
                                let $doc  := fn:doc($uri)
                                let $kind := xdmp:node-kind($doc/node()[1])
                                return
                                    <result uri="{$uri}"
                                            type="{$kind}"
                                            collections="{fn:string-join(xdmp:document-get-collections($uri), ',')}">{
                                        if ($doc instance of document-node())
                                        then xdmp:quote($doc/node()[1])
                                        else xdmp:quote($doc)
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

(:~
 : Build a search:options element from the stored constraints JSON array.
 : Handles both XML (element) and JSON (object-node/array-node) constraint types,
 : normalized by the frontend based on nodeKind + inferedTypes.
 :)
declare function resource:build-options(
    $constraints as node()*,
    $options-node as node()
) as element() {
    <options xmlns="http://marklogic.com/appservices/search">{
        (:– Return results –:)
        <return-results>true</return-results>,
        <return-facets>true</return-facets>,
        <return-estimates>true</return-estimates>,

        (:– Constraints –:)
        for $c in $constraints/node()
        let $cname      := fn:string($c/name)
        let $ctype      := fn:string($c/type)
        let $localname  := fn:string($c/localname)
        let $namespace  := fn:string($c/namespace)
        let $node-kind  := fn:string($c/nodeKind)
        let $facet      := fn:string($c/facet) eq "true"
        let $data-type  := resource:ml-data-type(fn:string($c/inferedTypes))
        return
            <constraint name="{$cname}">{
                if ($ctype = "range") then
                    if ($node-kind = ("object", "array") or $namespace eq "") then
                        (:– JSON range –:)
                        <range type="{$data-type}" facet="{$facet}">
                            <json-property>{$localname}</json-property>
                            {if ($facet) then <facet-option>limit=10</facet-option> else ()}
                        </range>
                    else
                        (:– XML range –:)
                        <range type="{$data-type}" facet="{$facet}">
                            <element ns="{$namespace}" name="{$localname}"/>
                            {if ($facet) then <facet-option>limit=10</facet-option> else ()}
                        </range>
                else if ($ctype = "word") then
                    if ($namespace eq "") then
                        <word>
                            <json-property>{$localname}</json-property>
                        </word>
                    else
                        <word>
                            <element ns="{$namespace}" name="{$localname}"/>
                        </word>
                else if ($ctype = "value") then
                    if ($namespace eq "") then
                        <value facet="{$facet}">
                            <json-property>{$localname}</json-property>
                            {if ($facet) then <facet-option>limit=10</facet-option> else ()}
                        </value>
                    else
                        <value facet="{$facet}">
                            <element ns="{$namespace}" name="{$localname}"/>
                            {if ($facet) then <facet-option>limit=10</facet-option> else ()}
                        </value>
                else if ($ctype = "collection") then
                    <collection facet="{$facet}">
                        {if ($facet) then <facet-option>limit=10</facet-option> else ()}
                    </collection>
                else ()
            }</constraint>
    }</options>
};

(:~
 : Map inferedTypes string to a MarkLogic search data type.
 :)
declare function resource:ml-data-type($infered as xs:string) as xs:string {
    if      ($infered = ("xs:integer","xs:long","xs:unsignedLong","xs:unsignedInteger")) then "xs:integer"
    else if ($infered = ("xs:decimal","xs:float","xs:double"))                           then "xs:decimal"
    else if ($infered eq "xs:date")                                                      then "xs:date"
    else if ($infered eq "xs:dateTime")                                                  then "xs:dateTime"
    else if ($infered eq "xs:boolean")                                                   then "xs:string"
    else                                                                                      "xs:string"
};
