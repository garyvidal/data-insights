xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/databases";

import module namespace admin = "http://marklogic.com/xdmp/admin"
    at "/MarkLogic/admin.xqy";

declare variable $SYSTEM-DBS := ("Security","Triggers","Schemas","Modules","App-Services","Last-Login","Fab","ContentAnalyzer");

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $databases :=
        for $db in xdmp:databases()
        where fn:not(xdmp:database-name($db) = ($SYSTEM-DBS, xdmp:database-name(xdmp:database())))
        order by xdmp:database-name($db)
        return
            <database type="string">{xdmp:database-name($db)}</database>
    return
        document {
            <databases type="array">
                <database type="string"/>
                {$databases}
            </databases>
        }
};
