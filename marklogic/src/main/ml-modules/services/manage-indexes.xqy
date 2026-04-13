xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/manage-indexes";

declare namespace error = "http://marklogic.com/xdmp/error";
declare namespace db    = "http://marklogic.com/xdmp/database";

(:~
 : Manage range path indexes for faceted search constraints.
 :
 : GET  ?action=list&db=...  → list existing range-path-indexes on the database
 : POST rs:action=sync       → create missing range indexes for faceted constraints
 :      rs:db                → target database name
 :      rs:constraints       → JSON array of constraint objects
 :      rs:drop-missing      → "true" to also remove indexes not in the list
 :)

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $action := map:get($params, "action")
    let $db     := map:get($params, "db")
    return
        if ($action = "list") then
            let $db-id  := xdmp:database($db)
            let $result := xdmp:eval(
                'import module namespace admin = "http://marklogic.com/xdmp/admin"
                     at "/MarkLogic/admin.xqy";
                 declare namespace db = "http://marklogic.com/xdmp/database";
                 declare variable $db-id as xs:unsignedLong external;
                 let $cfg     := admin:get-configuration()
                 let $indexes := admin:database-get-range-path-indexes($cfg, $db-id)
                 return <indexes>{$indexes}</indexes>',
                (xs:QName("db-id"), $db-id),
                <options xmlns="xdmp:eval"><isolation>different-transaction</isolation></options>
            )
            return
                document {
                    object-node {
                        "indexes": array-node {
                            for $idx in $result/db:range-path-index
                            return object-node {
                                "path":   fn:string($idx/db:path-expression),
                                "scalar": fn:string($idx/db:scalar-type)
                            }
                        }
                    }
                }
        else
            document { object-node { "error": "unknown action" } }
};

declare function post(
    $context as map:map,
    $params  as map:map,
    $input   as document-node()*
) as document-node()? {
    let $action           := map:get($params, "action")
    let $db               := map:get($params, "db")
    let $constraints-json := map:get($params, "constraints")
    let $drop-missing     := map:get($params, "drop-missing") = "true"

    return
        if ($action = "sync") then
            try {
                let $db-id       := xdmp:database($db)
                let $constraints := xdmp:unquote($constraints-json)/array-node()/object-node()
                let $faceted     := $constraints[fn:string(./facet) = "true"]

                let $result := xdmp:eval(
                    'import module namespace admin = "http://marklogic.com/xdmp/admin"
                         at "/MarkLogic/admin.xqy";
                     declare namespace db = "http://marklogic.com/xdmp/database";
                     declare variable $db-id       as xs:unsignedLong external;
                     declare variable $desired-xml as element()        external;
                     declare variable $drop        as xs:boolean       external;

                     let $cfg            := admin:get-configuration()
                     let $existing       := admin:database-get-range-path-indexes($cfg, $db-id)
                     let $existing-paths := $existing/db:path-expression/fn:string(.)

                     (: Add each missing index one at a time, threading config through :)
                     let $cfg2 :=
                         fn:fold-left(
                             function($c, $idx) {
                                 let $path   := fn:string($idx/path)
                                 let $scalar := fn:string($idx/scalar)
                                 let $coll   := if ($scalar eq "string")
                                                then "http://marklogic.com/collation/"
                                                else ""
                                 return
                                     if ($path = $existing-paths) then $c
                                     else
                                         admin:database-add-range-path-index(
                                             $c, $db-id,
                                             admin:database-range-path-index(
                                                 $db-id, $scalar, $path, $coll, fn:false(), "ignore"
                                             )
                                         )
                             },
                             $cfg,
                             $desired-xml/idx
                         )

                     (: Optionally remove indexes not in desired list :)
                     let $desired-paths := $desired-xml/idx/path/fn:string(.)
                     let $cfg3 :=
                         if ($drop) then
                             fn:fold-left(
                                 function($c, $e) {
                                     let $path := fn:string($e/db:path-expression)
                                     return
                                         if ($path = $desired-paths) then $c
                                         else admin:database-delete-range-path-index($c, $db-id, $e)
                                 },
                                 $cfg2,
                                 $existing
                             )
                         else $cfg2

                     let $added := fn:count(
                         $desired-xml/idx[not(fn:string(path) = $existing-paths)]
                     )
                     return (
                         admin:save-configuration-without-restart($cfg3),
                         <result><added>{$added}</added></result>
                     )',
                    (xs:QName("db-id"),       $db-id,
                     xs:QName("desired-xml"), <desired>{
                         for $c in $faceted
                         return <idx>
                             <path>{resource:path-for-constraint($c)}</path>
                             <scalar>{resource:scalar-type(fn:string($c/inferedTypes))}</scalar>
                         </idx>
                     }</desired>,
                     xs:QName("drop"),        $drop-missing),
                    <options xmlns="xdmp:eval"><isolation>different-transaction</isolation></options>
                )

                let $added := xs:integer(($result[self::element()]/added, 0)[1])
                return
                    document {
                        object-node {
                            "status":  "ok",
                            "indexed": fn:count($faceted),
                            "added":   $added,
                            "message": fn:concat(
                                "Synced ", fn:count($faceted), " index(es) on ", $db,
                                " (", $added, " newly created)"
                            )
                        }
                    }
            } catch ($ex) {
                document {
                    object-node {
                        "status":  "error",
                        "message": fn:data($ex/error:format-string)
                    }
                }
            }
        else
            document { object-node { "error": "unknown action" } }
};

declare function resource:path-for-constraint($c as node()) as xs:string {
    let $localname := fn:string($c/localname)
    let $namespace := fn:string($c/namespace)
    let $infered   := fn:string($c/inferedTypes)
    return
        if ($namespace eq "") then
            (: JSON field — use text() for scalar values, boolean-node() for booleans :)
            if ($infered eq "xs:boolean")
            then fn:concat('//boolean-node("', $localname, '")')
            else fn:concat('//text("', $localname, '")')
        else
            (: XML element with namespace :)
            fn:concat("//ns:", $localname)
};

declare function resource:scalar-type($infered as xs:string) as xs:string {
    if      ($infered = ("xs:integer","xs:long","xs:unsignedLong","xs:unsignedInteger")) then "int"
    else if ($infered = ("xs:decimal","xs:float","xs:double"))                           then "decimal"
    else if ($infered eq "xs:date")                                                      then "date"
    else if ($infered eq "xs:dateTime")                                                  then "dateTime"
    else                                                                                      "string"
};
