xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/analysis";

import module namespace excel = "http://marklogic.com/openxml/excel"
    at "/lib/spreadsheet-ml-support2.xqy";

declare namespace local = "urn:local";
declare namespace ca    = "http://marklogic.com/content-analyzer";
declare default element namespace "http://marklogic.com/content-analyzer";

(:~
 : Recursively builds a table structure describing the element hierarchy.
 : $traversed is passed explicitly to avoid module-level mutable state.
~:)
declare function resource:recurse($current, $elems, $attrs, $meta, $nss, $depth, $path, $traversed as map:map)
{
    let $childs :=
        for $c in $elems[parent-key eq $current/child-key]
        order by
            if (fn:starts-with($c/parent-key, $c/child-key)) then 9999 else -1,
            xs:integer(($current/min-distance[. ne ""], 0)[1]),
            xs:integer(($current/max-distance[. ne ""], 0)[1])
        return $c
    let $curmeta    := $meta[key eq $current/child-key]
    let $ns-prefix  := $nss/namespace[namespace-uri eq $current/child-namespace]/prefix
    let $prefix     := if ($ns-prefix and $ns-prefix ne "*") then fn:concat($ns-prefix, ":") else ""
    let $xpath      := fn:concat($path, "/", $prefix, $current/child-localname)
    let $attributes :=
        for $a in $attrs[element-key eq $current/child-key]
        let $a-prefix  := $nss/namespace[namespace-uri eq $a/attribute-namespace]/prefix
        let $a-pre     := if ($a-prefix and $a-prefix ne "*") then fn:concat($a-prefix, ":") else ""
        let $attr-xpath := fn:concat($xpath, "/@", $a-pre, $a/attribute-localname)
        order by $a/attribute-localname
        return
            <node type="attribute">
                <key>{fn:data($a/key)}-{$depth + 1}</key>
                <parent-key>{fn:data($a/element-key)}-{$depth}</parent-key>
                <child-key>{fn:data($a/attribute-key)}</child-key>
                <parent-child-key>{fn:data($a/key)}</parent-child-key>
                <type>attribute</type>
                <namespace>{fn:data($a/attribute-namespace)}</namespace>
                <localname>@{$a-pre}{fn:data($a/attribute-localname)}</localname>
                <min-distance>0</min-distance>
                <max-distance>0</max-distance>
                <frequency>{fn:data($a/frequency)}</frequency>
                <distinct-values>{fn:data($a/distinct-values)}</distinct-values>
                <infered-types>{fn:data($a/infered-types)}</infered-types>
                <min-length>{fn:data($a/min-length)}</min-length>
                <max-length>{fn:data($a/max-length)}</max-length>
                <average-length>{fn:data($a/average-length)}</average-length>
                <min-value>{fn:data($a/min-value)}</min-value>
                <max-value>{fn:data($a/max-value)}</max-value>
                <avg-value>{fn:data($a/avg-value)}</avg-value>
                <median-value>{fn:data($a/median-value)}</median-value>
                <xpath>{$attr-xpath}</xpath>
                <!--grid-->
                <level>{$depth + 1}</level>
                <parent>{fn:data($a/element-key)}-{$depth}</parent>
                <isLeaf>true</isLeaf>
                <expanded>true</expanded>
                <loaded>true</loaded>
            </node>
    return
        if ($childs and fn:not(map:get($traversed, fn:string($current/key)))) then
        ( (:Nodes with Complex Relationship:)
            <node type="complex">
                <key>{fn:data($current/child-key)}-{$depth}</key>
                <parent-key>{
                    if (xdmp:md5("") eq $current/parent-key)
                    then "NULL"
                    else fn:data($current/parent-key)}-{$depth - 1}</parent-key>
                <child-key>{fn:data($current/child-key)}</child-key>
                <parent-child-key>{fn:data($current/key)}</parent-child-key>
                <type>element</type>
                <namespace>{fn:data($current/child-namespace)}</namespace>
                <localname>{$prefix}{fn:data($current/child-localname)}</localname>
                <min-distance>{fn:data($current/min-distance)}</min-distance>
                <max-distance>{fn:data($current/max-distance)}</max-distance>
                <frequency>{fn:data($current/frequency)}</frequency>
                <distinct-values>{fn:data($current/distinct-values)}</distinct-values>
                <infered-types>{""}</infered-types>
                <min-length>{fn:data($current/min-length)}</min-length>
                <max-length>{fn:data($current/max-length)}</max-length>
                <average-length>{fn:data($current/average-length)}</average-length>
                <min-value>{fn:data($current/min-value)}</min-value>
                <max-value>{fn:data($current/max-value)}</max-value>
                <avg-value>{fn:data($current/avg-value)}</avg-value>
                <median-value>{fn:data($current/avg-value)}</median-value>
                <xpath>{$xpath}</xpath>
                <!--grid-->
                <level>{$depth}</level>
                <parent>{fn:data($current/parent-key)}-{$depth - 1}</parent>
                <isLeaf>false</isLeaf>
                <expanded>true</expanded>
                <loaded>true</loaded>
            </node>,
            $attributes,
            map:put($traversed, fn:string($current/key), fn:string($current/key)),
            for $c in $childs
            return (resource:recurse($c, $elems, $attrs, $meta, $nss, $depth + 1, $xpath, $traversed),
                    map:put($traversed, fn:string($c/key), fn:string($c/key)))
        )
        else if (fn:not(map:get($traversed, fn:string($current/key)))) then
        ( (:Nodes with Simple Types:)
            <node type="element">
                <key>{fn:data($current/child-key)}-{$depth}</key>
                <parent-key>{fn:data($current/parent-key)}-{$depth - 1}</parent-key>
                <child-key>{fn:data($current/child-key)}</child-key>
                <parent-child-key>{fn:data($current/key)}</parent-child-key>
                <type>element</type>
                <namespace>{fn:data($current/child-namespace)}</namespace>
                <localname>{$prefix}{fn:data($current/child-localname)}</localname>
                <min-distance>{fn:data($current/min-distance)}</min-distance>
                <max-distance>{fn:data($current/max-distance)}</max-distance>
                <frequency>{fn:data($current/frequency)}</frequency>
                <distinct-values>{fn:data($current/distinct-values)}</distinct-values>
                <infered-types>{fn:data($current/infered-types)}</infered-types>
                <min-length>{fn:data($current/min-length)}</min-length>
                <max-length>{fn:data($current/max-length)}</max-length>
                <average-length>{fn:data($current/average-length)}</average-length>
                <min-value>{fn:data($current/min-value)}</min-value>
                <max-value>{fn:data($current/max-value)}</max-value>
                <median-value>{fn:data($curmeta/median-value)}</median-value>
                <xpath>{$xpath}</xpath>
                <!--grid-->
                <level>{$depth}</level>
                <parent>{fn:data($current/parent-key)}-{$depth - 1}</parent>
                <isLeaf>{fn:not(fn:exists($attributes))}</isLeaf>
                <expanded>true</expanded>
                <loaded>true</loaded>
            </node>,
            $attributes,
            map:put($traversed, fn:string($current/key), fn:string($current/key))
        )
        else ()
};

declare function resource:export($results)
{
    excel:create-xlsx-from-xml-table(element document {$results/*:node})
};

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $db          := map:get($params, "db")
    let $type        := (map:get($params, "type"), "root")[1]
    let $id          := (map:get($params, "id"), "")[1]
    let $key         := (map:get($params, "key"), "")[1]
    let $sort-index  := (map:get($params, "sidx"), "")[1]
    let $sort-order  := (map:get($params, "sord"), "ascending")[1]
    let $page        := xs:integer((map:get($params, "page"), "1")[1])
    let $rows        := xs:integer((map:get($params, "rows"), "20")[1])
    let $analysis-id := (map:get($params, "analysis-id"), "-1")[1]
    let $start       := (($page - 1) * $rows) + 1
    let $end         := $page * $rows
    let $root-key    := xdmp:md5("")
    return
        if ($type eq "root") then
            document {
                <root-elements>{
                    for $x in /root-element[database eq $db]
                    order by $x/localname
                    return $x
                }</root-elements>
            }
        else if ($type eq "element" and $id ne "") then
            document {
                <elements>{
                    for $x in /content-analysis[root-element/id eq $id]/elements/element
                    return
                        <element>{$x/* except $x/values}</element>
                }</elements>
            }
        else if ($type eq "attribute" and $id ne "") then
            document {
                <attributes>{
                    for $x in /content-analysis[analysis-id = $analysis-id]/attributes/attribute
                    return
                        <attribute>{$x/* except $x/values}</attribute>
                }</attributes>
            }
        else if ($type eq "element-attribute") then
            document {
                <element-attributes>{
                    for $v in /content-analysis[analysis-id = $analysis-id]/element-attribute[parent-key = $id]
                    return xdmp:quote($v)
                }</element-attributes>
            }
        else if ($type eq "element-element") then
            document {
                <element-elements>{
                    /content-analysis[analysis-id = $analysis-id]/element-element
                }</element-elements>
            }
        else if ($type eq "namespace") then
            document {
                <namespaces>{
                    for $ns in /content-analysis[analysis-id = $analysis-id]/namespaces/namespace
                    order by $ns/prefix
                    return $ns
                }</namespaces>
            }
        else if ($type eq "xpath") then
            let $analysis := /content-analysis[analysis-id = $analysis-id]
            let $node     := $analysis//(element-attribute|element)[(attribute-key|key) = $id]
            let $sort-string :=
                fn:string-join((
                    if ($sort-index eq "value")
                    then "fn:string($x/xpath-uri)"
                    else "xs:integer($x/xpath-frequency)",
                    if ($sort-order eq "asc")     then ""
                    else if ($sort-order eq "desc") then "descending"
                    else ""
                ), " ")
            let $count   := fn:count($node/xpaths/xpath)
            let $pages   := fn:ceiling($count div $rows)
            let $records := xdmp:value(fn:concat('for $x in $node/xpaths/xpath order by ', $sort-string, ' return $x'))
            return
                document {
                    <values>
                        <page>{$page}</page>
                        <total>{$pages}</total>
                        <records>{$count}</records>
                        {$records[$start to $end]}
                    </values>
                }
        else if ($type eq "uris") then
            let $analysis := /content-analysis[analysis-id = $analysis-id]
            let $node     := $analysis/documents
            let $sort-string :=
                fn:string-join((
                    if ($sort-index eq "value")
                    then "fn:string($x/uri)"
                    else "xs:integer($x/document-size)",
                    if ($sort-order eq "asc")     then ""
                    else if ($sort-order eq "desc") then "descending"
                    else ""
                ), " ")
            let $count   := fn:count($node/document)
            let $pages   := fn:ceiling($count div $rows)
            let $records := xdmp:value(fn:concat('for $x in $node/document order by ', $sort-string, ' return $x'))
            return
                document {
                    <values>
                        <page>{$page}</page>
                        <total>{$pages}</total>
                        <records>{$count}</records>
                        {$records[$start to $end]}
                    </values>
                }
        else if ($type eq "attribute-values") then
            let $analysis := /content-analysis[analysis-id = $analysis-id]
            let $node     := $analysis/element-attributes/element-attribute[key eq $id]
            let $vtype    := $node/infered-types
            let $sort-string :=
                fn:string-join((
                    if ($sort-index eq "key")
                    then if ($vtype = ("xs:integer","xs:decimal","xs:float","xs:double","xs:long"))
                         then "fn:number($x/key)"
                         else "fn:string($x/key)"
                    else "xs:integer($x/frequency)",
                    if ($sort-order eq "asc")     then ""
                    else if ($sort-order eq "desc") then "descending"
                    else ""
                ), " ")
            let $count   := fn:count($node/values/value)
            let $pages   := fn:ceiling($count div $rows)
            let $records := xdmp:value(fn:concat('for $x in $node/values/value order by ', $sort-string, ' return $x'))
            return
                document {
                    <values>
                        <page>{$page}</page>
                        <total>{$pages}</total>
                        <records>{$count}</records>
                        {$records[$start to $end]}
                    </values>
                }
        else if ($type eq "element-values") then
            let $node    := /content-analysis[analysis-id = $analysis-id]/element-elements/element-element[key eq $id]
            let $vtype   := $node/infered-types
            let $sort-string :=
                fn:string-join((
                    if ($sort-index eq "key")
                    then if ($vtype = ("xs:integer","xs:decimal","xs:float","xs:double","xs:long"))
                         then "fn:number($x/key)"
                         else "fn:string($x/key)"
                    else "xs:integer($x/frequency)",
                    if ($sort-order eq "asc")     then ""
                    else if ($sort-order eq "desc") then "descending"
                    else ""
                ), " ")
            let $count   := fn:count($node/values/value)
            let $pages   := fn:ceiling($count div $rows)
            return
                document {
                    <values>
                        <page>{$page}</page>
                        <total>{$pages}</total>
                        <records>{$count}</records>
                        {
                            xdmp:value(fn:concat(
                                '(for $x in $node/values/value order by ', $sort-string,
                                ' return $x)[$start to $end]'))
                        }
                    </values>
                }
        else if ($type = ("structure", "export")) then
            let $analysis  := /content-analysis[analysis-id = $analysis-id]
            let $root-k    := xdmp:md5("")
            let $elems     := $analysis/elements/element
            let $nss       :=
                <namespaces>{
                    for $ns in $analysis/namespaces/namespace
                    order by $ns/prefix
                    return $ns
                }</namespaces>
            let $child     := $analysis/element-elements/element-element
            let $attrs     := $analysis/element-attributes/element-attribute
            let $root      := 
                  if($analysis/root-element/type eq "json")
                  then (
                      $child[parent-localname eq ""]
                      )
                  else (
                    $child[parent-key eq $root-k]
                  )
            let $traversed := map:map()
            let $structure :=
                <structure>{
                    $analysis/sampled,
                    $nss,
                    $analysis/document-statistics,
                    for $r in $root return resource:recurse($r, $child, $attrs, $elems, $nss, 0, "  ", $traversed)
                }</structure>
            return (
                if ($type eq "export")
                then xdmp:add-response-header("Content-Disposition",
                        fn:concat("filename=", xdmp:url-encode($analysis/name), ".xlsx"))
                else (),
                if ($type eq "export")
                then document { resource:export($structure) }
                else document { $structure }
            )
        else if ($type eq "document-stats") then
            document {
                /content-analysis[analysis-id = $analysis-id]/document-statistics
            }
        else
            document { <error>unknown type</error> }
};

declare function delete(
    $context as map:map,
    $params  as map:map
) as document-node()? {
    let $id := map:get($params, "id")
    return
        document {
            if ($id)
            then
                let $_ := cts:search(/ca:content-analysis,
                            cts:element-value-query(xs:QName("ca:analysis-id"), $id))/xdmp:node-delete(.)
                return <message>deleted</message>
            else
                <message>error</message>
        }
};
