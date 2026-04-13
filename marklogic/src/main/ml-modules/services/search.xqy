xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/search";

import module namespace search = "http://marklogic.com/appservices/search"
    at "/MarkLogic/appservices/search/search.xqy";

declare namespace s     = "http://marklogic.com/appservices/search";
declare namespace error = "http://marklogic.com/xdmp/error";

(:~
 : Export the built search:options XML for a saved options set.
 :
 : GET params:
 :   options-id – id of a saved search-options document
 :)
declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $options-id := map:get($params, "options-id")
    let $opts-doc := cts:search(/,
        cts:and-query((
            cts:collection-query("search-options"),
            cts:json-property-value-query("id", $options-id)
        )))[1]
    return
        if (fn:empty($opts-doc)) then
            document { <error>Search options not found for id: {$options-id}</error> }
        else
            let $constraint-nodes := $opts-doc/object-node()/options/constraints
            return document { resource:build-options($constraint-nodes) }
};

(:~
 : Execute a search using a named search option set.
 :
 : POST body fields (rs: prefixed):
 :   db         – target database
 :   options-id – id of a saved search-options document
 :   query      – query string (passed to search:search); empty = match all
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
    let $query-str  := fn:normalize-space(map:get($params, "query"))
    let $page       := xs:integer((map:get($params, "page"),     "1")[1])
    let $page-size  := xs:integer((map:get($params, "pageSize"), "25")[1])
    let $start      := (($page - 1) * $page-size) + 1

    let $opts-doc := cts:search(/,
        cts:and-query((
            cts:collection-query("search-options"),
            cts:json-property-value-query("id", $options-id)
        )))[1]

    return
            let $root             := $opts-doc/object-node()
            let $opts-node        := $root/options
            let $constraint-nodes := $opts-node/constraints
            let $_ := xdmp:log(("constraint-nodes",$constraint-nodes), "info")
            let $search-opts      := resource:build-options($constraint-nodes)
            let $_ := xdmp:log(("search-opts",$search-opts), "info")
            let $parsed :=
                try {
                    let $response := xdmp:invoke-function(function() {
                         let $sr    := search:search($query-str, $search-opts, $start, $page-size)
                         let $total := xs:integer(($sr/@total, 0)[1])
                         return
                             <response>
                                 <total>{$total}</total>
                                 <facets>{
                                     for $f in $sr/s:facet
                                     return
                                         <facet name="{fn:string($f/@name)}">{
                                             for $fv in $f/s:facet-value
                                             return
                                                 <value name="{fn:string($fv/@name)}" count="{fn:string($fv/@count)}"/>
                                         }</facet>
                                 }</facets>
                                 <results>{
                                     for $r in $sr/s:result
                                     let $uri  := fn:string($r/@uri)
                                     let $doc  := fn:doc($uri)
                                     let $kind := xdmp:node-kind($doc/node()[1])
                                     return
                                         <result uri="{$uri}"
                                                 type="{$kind}"
                                                 collections="{fn:string-join(xdmp:document-get-collections($uri), ",")}">{
                                             xdmp:quote($doc/node()[1])
                                         }</result>
                                 }</results>
                             </response>
                    },
                    <options xmlns="xdmp:eval">
                        <database>{xdmp:database($db)}</database>
                    </options>
                    )
                    let $total := xs:integer(($response/total, 0)[1])
                    return
                        <response>
                            <valid>true</valid>
                            <estimate>{$total}</estimate>
                            <page>{$page}</page>
                            <pageSize>{$page-size}</pageSize>
                            <facets>{$response/facets/node()}</facets>
                            <results>{$response/results/node()}</results>
                        </response>
                } catch ($ex) {
                    (
                        xdmp:log($ex),
                        <response>
                            <valid>false</valid>
                            <error>{xdmp:quote($ex)}</error>
                        </response>
                    )
                }
            return document { $parsed }
};

(:~
 : Build a search:options element from the stored constraints JSON array.
 : Each $c is a JSON object-node; use /key child steps to read properties.
 :)
declare function resource:build-options(
    $constraint-nodes as object-node()*
) as element() {
    <options xmlns="http://marklogic.com/appservices/search">{
        <return-results>true</return-results>,
        <return-facets>true</return-facets>,
        <return-estimates>true</return-estimates>,
        <fragment-scope>documents</fragment-scope>,

        for $c in $constraint-nodes
        let $cname     := fn:string($c/text("name"))
        let $localname := fn:string($c/text("localname"))
        let $namespace := fn:string($c/text("namespace"))
        let $node-kind := fn:string($c/text("nodeKind"))
        let $facet     := fn:string($c/boolean-node("facet")) eq "true"
        let $data-type := resource:ml-data-type(fn:string($c/text("inferedTypes")))
        (: If facet=true, always use range — only range constraints return facet counts :)
        let $ctype     := if ($facet) then "range" else fn:string($c/text("type"))
        let $is-json   := ($namespace eq "")
        let $facet-order := (fn:string($c/text("facetOrder")), "frequency-descending")[. ne ""][1]
        let $facet-opts  :=
            if ($facet) then (
                <facet-option>limit=10</facet-option>,
                if      ($facet-order eq "frequency-descending") then (<facet-option>frequency-order</facet-option>, <facet-option>descending</facet-option>)
                else if ($facet-order eq "frequency-ascending")  then (<facet-option>frequency-order</facet-option>, <facet-option>ascending</facet-option>)
                else if ($facet-order eq "value-ascending")      then (<facet-option>item-order</facet-option>,      <facet-option>ascending</facet-option>)
                else if ($facet-order eq "value-descending")     then (<facet-option>item-order</facet-option>,      <facet-option>descending</facet-option>)
                else ()
            ) else ()
        let $constraints :=
            <constraint name="{$cname}">{
                if ($ctype = "range") then
                    let $collation  := if ($data-type eq "xs:string") then "http://marklogic.com/collation/" else ""
                    let $infered    := fn:string($c/text("inferedTypes"))
                    let $path-expr  := if ($infered eq "xs:boolean")
                                       then fn:concat('//boolean-node("', $localname, '")')
                                       else fn:concat('//text("', $localname, '")')
                    return
                    if ($is-json) then
                        <range type="{$data-type}" facet="{$facet}">{
                            if ($collation ne "") then attribute collation { $collation } else ()
                        }<path-index>{$path-expr}</path-index>
                            {$facet-opts}
                        </range>
                    else
                        <range type="{$data-type}" facet="{$facet}">{
                            if ($collation ne "") then attribute collation { $collation } else ()
                        }<element ns="{$namespace}" name="{$localname}"/>
                            {$facet-opts}
                        </range>
                else if ($ctype = "word") then
                    if ($is-json) then
                        <word><json-property>{$localname}</json-property></word>
                    else
                        <word><element ns="{$namespace}" name="{$localname}"/></word>
                else if ($ctype = "value") then
                    if ($is-json) then
                        <value>
                            <json-property>{$localname}</json-property>
                            {if ($facet) then <facet-option>limit=10</facet-option> else ()}
                        </value>
                    else
                        <value>
                            <element ns="{$namespace}" name="{$localname}"/>
                            {if ($facet) then <facet-option>limit=10</facet-option> else ()}
                        </value>
                else if ($ctype = "collection") then
                    <collection facet="{$facet}">
                        {if ($facet) then <facet-option>limit=10</facet-option> else ()}
                    </collection>
                else ()
            }</constraint>
        return $constraints
    }</options>
};

(:~
 : Map inferedTypes string to a MarkLogic search data type.
 :)
declare function resource:ml-data-type($infered as xs:string) as xs:string {
    if      ($infered = ("xs:integer","xs:long","xs:unsignedLong","xs:unsignedInteger")) then "xs:int"
    else if ($infered = ("xs:decimal","xs:float","xs:double"))                           then "xs:decimal"
    else if ($infered eq "xs:date")                                                      then "xs:date"
    else if ($infered eq "xs:dateTime")                                                  then "xs:dateTime"
    else if ($infered eq "xs:boolean")                                                   then "xs:string"
    else                                                                                      "xs:string"
};
