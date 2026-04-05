xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/root-elements";

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $db := map:get($params, "db")
    return
        xdmp:invoke("/lib/get-document-roots.xqy",
            (xs:QName("DATABASE"), $db),
            <options xmlns="xdmp:eval">
                <database>{xdmp:database($db)}</database>
            </options>
        )
};
