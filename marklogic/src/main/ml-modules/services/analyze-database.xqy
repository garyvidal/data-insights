xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/analyze-database";

declare namespace ca = "http://marklogic.com/content-analyzer";

declare option xdmp:mapping "false";

declare variable $default-constraint := "cts:and-query(())";

declare function post(
    $context as map:map,
    $params  as map:map,
    $input   as document-node()*
) as document-node()? {
    let $_ := xdmp:log(("Starting analyze-database input::", $input), "info")
    let $body       := $input/object-node()
    let $db         := $body/db/fn:string(.)
    let $sample     := ($body/sample/fn:string(.), "100")[1] cast as xs:integer
    let $constraint := ($body/constraint/fn:string(.), "cts:and-query(())")[1]
    let $xpath      := ($body/xpath/fn:string(.), "")[1]
    let $name       := ($body/name/fn:string(.), fn:concat("Analysis:", $db, " ", fn:current-dateTime()))[1]
    let $all        := ($body/all/fn:string(.), "false")[1]
    let $select-ids := $body/rootElements/fn:string(.)
    let $_          := xdmp:log(("selected-ids::", $select-ids), "info")
    let $namespaces :=
        if (/ca:namespace-list[ca:database = $db])
        then /ca:namespace-list[ca:database = $db]
        else <ca:namespace-list/>
    let $ns-seq := $namespaces/ca:namespace/(ca:prefix|ca:namespace-uri)/fn:string(.)
    let $_      := xdmp:log(("namespaces::", $ns-seq), "info")
    let $cts-constraint :=
        <c>{xdmp:value("xdmp:with-namespaces($ns-seq, $constraint)")}</c>/*
    let $cts-constraint := ($cts-constraint, cts:and-query(()))[1]
    let $root-elements :=
        xdmp:invoke("/lib/get-document-roots.xqy",
            (
                fn:QName("", "DATABASE"),        $db,
                fn:QName("", "CONSTRAINT-QUERY"), $cts-constraint
            ),
            <options xmlns="xdmp:eval">
                <database>{xdmp:database($db)}</database>
            </options>
        )/ca:root-elements
    let $root-elements :=
        if ($all = ("on", "true"))
        then $root-elements/ca:root-element
        else $root-elements/ca:root-element[ca:id = $select-ids]
    let $_ :=
        for $re in $root-elements
        let $ticket-id := xdmp:random()
        let $_ := xdmp:log(("Created Ticket::", $ticket-id), "info")
        let $_ticket :=
            xdmp:eval('
                declare variable $ticket-id external;
                declare variable $re external;
                xdmp:document-insert(fn:concat("/tickets/", $ticket-id, ".xml"),
                <ticket xmlns="http://marklogic.com/content-analyzer">
                    <id>{$ticket-id}</id>
                    <status>Started</status>
                    {$re}
                </ticket>,
                xdmp:default-permissions(),
                ("tickets")
                )',
                (xs:QName("ticket-id"), $ticket-id, xs:QName("re"), $re),
                <options xmlns="xdmp:eval"><isolation>different-transaction</isolation></options>
            )
        return (
            xdmp:log("spawned analyze-documents.xqy for root element: " || $re, "info"),
            xdmp:spawn("/lib/analyze-documents.xqy",
                (
                    xs:QName("_root-element"),   $re,
                    xs:QName("_database"),       $db,
                    xs:QName("_callback-db"),    xdmp:database-name(xdmp:database()),
                    xs:QName("_sample"),         $sample,
                    xs:QName("_ticket"),         $ticket-id,
                    xs:QName("_constraint"),     $constraint,
                    xs:QName("_xpath"),          $xpath,
                    xs:QName("_name"),           $name,
                    xs:QName("_namespaces"),     $namespaces
                ),
                <options xmlns="xdmp:eval">
                    <database>{xdmp:database($db)}</database>
                </options>
            )
        )
    return ()
};
