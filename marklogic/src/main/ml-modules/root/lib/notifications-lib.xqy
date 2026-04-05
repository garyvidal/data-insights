xquery version "1.0-ml";

module namespace lib = "http://marklogic.com/content-analyzer/notification";

declare function add-notification(
    $title,
    $message,
    $status
){
 let $id :=  xdmp:random()
 return
 (
  xdmp:document-insert(
     fn:concat("/notifications/notification-",$id,".xml"),
     <notification>
        <created>{fn:current-dateTime()}</created>
        <user>{xdmp:get-current-user()}</user>
        <received></received>
        <title>{$title}</title>
        <message>{$message}</message>
        <status>{$status}</status>
     </notification>,
     xdmp:default-permissions(),
     ("notification")
 ),
  $id
 )
};
(:
 : Returns unread notifications for the current user and marks them as received.
 : The mark-received step runs in a separate auto-committed update transaction
 : so this function can safely be called from a GET (query) context.
:)
declare function get-notifications()
{
   let $notifications := /notification[user eq xdmp:get-current-user() and received eq ""]
   let $_ :=
     for $n in $notifications
     let $uri := xdmp:node-uri($n)
     return xdmp:spawn-function(function() {
       xdmp:node-replace(
         doc($uri)/notification/received,
         <received>{fn:current-dateTime()}</received>
       )
     })
   return $notifications
};