xquery version "1.0-ml";

declare variable $db as xs:string external;
let $options := 
  <options xmlns="xdmp:eval">
     <database>{xdmp:database($db)}</database>
  </options>
let $task-module := "/lib/tasks/root-element/task.xqy"
let $complete-module := "/lib/tasks/root-element/complete.xqy"
let $uris := xdmp:eval('cts:uris("",("map"))',(),<options xmlns="xdmp:eval"><database>{xdmp:database($db)}</database></options>)
let $uow  := fn:ceiling(map:count($uris) div 990)
return
  try {
  xdmp:spawn("/lib/task-spawner.xqy",
     (
      xs:QName("INPUT"),$uris,
      xs:QName("OUTPUT"),map:map(),
      xs:QName("TASK-PROPERTIES"),map:map(),
      xs:QName("TASK-MODULE"),$task-module,
      xs:QName("TASK-UOW"),$uow,
      xs:QName("COMPLETE-MODULE"),$complete-module,
      xs:QName("complete-options"),<options xmlns="xdmp:eval"/>,
      xs:QName("task-options"),$options
     )
  )
  } catch($ex) {
    <error>{$ex}</error>/*
  }