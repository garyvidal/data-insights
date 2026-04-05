xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/notifications";

import module namespace notification = "http://marklogic.com/content-analyzer/notification"
    at "/lib/notifications-lib.xqy";

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    document {
        <notifications>{
            notification:get-notifications()
        }</notifications>
    }
};
