module namespace eval = "http://marklogic.com/eval";

declare function eval:doc($uri,$db)
{
   xdmp:eval(fn:concat("fn:doc('",$uri,"')"),(),
     <options xmlns="xdmp:eval">
       <database>{xdmp:database($db)}</database>
    </options>
   )
};

declare function eval:doc-available($uri,$db)
{
   xdmp:eval(fn:concat("fn:doc-available('",$uri,"')"),(),
     <options xmlns="xdmp:eval">
       <database>{xdmp:database($db)}</database>
     </options>
   )
};

declare function eval:document-delete($uri,$db)
{
  xdmp:eval(fn:concat("xdmp:document-delete('",$uri,"')"),(),
     <options xmlns="xdmp:eval">
       <database>{xdmp:database($db)}</database>
     </options>
   )
};

declare function eval:document-properties($uri,$db)
{
   xdmp:eval(fn:concat("xdmp:document-properties('",$uri,"')"),(),
     <options xmlns="xdmp:eval">
       <database>{xdmp:database($db)}</database>
     </options>
   )
};

declare function eval:document-get-collections($uri,$db)
{
   xdmp:eval(fn:concat("xdmp:document-get-collections('",$uri,"')"),(),
     <options xmlns="xdmp:eval">
       <database>{xdmp:database($db)}</database>
     </options>
   )   
};

declare function eval:document-insert($uri,$node,$db) {
  let $stmt := 
    ' declare variable $uri as xs:string external;
      declare variable $node as node() external;
      xdmp:document-insert($uri,$node)
    '
  return
    xdmp:eval($stmt,(
      xs:QName("uri"),$uri,
      xs:QName("node"),$node
    ),
    <options xmlns="xdmp:eval">
      <database>{xdmp:database($db)}</database>
    </options>)
};

declare function eval:document-insert($uri,$node,$permissions,$db)
{
   let $stmt := fn:concat(
   "xdmp:document-insert('",$uri, "'",
    xdmp:describe($node,(),()), ", ",
    xdmp:describe($permissions,(),()), ")"
   )
   return
     xdmp:eval($stmt,(),
       <options xmlns="xdmp:eval">
         <database>{xdmp:database($db)}</database>
       </options>)
};

declare function eval:document-insert($uri,$node,$permissions,$collections,$db)
{
   ()
};

declare function eval:document-insert($uri,$document,$permissions,$collections,$quality,$db)
{
   ()
};

(:Directory Functions:)
declare function eval:directory-create($uri,$db)
{
   xdmp:eval(fn:concat("xdmp:directory-create('",$uri,"')"),(),
     <options xmlns="xdmp:eval">
       <database>{xdmp:database($db)}</database>
     </options>
   )
};
declare function eval:directory-delete($uri,$db)
{
   xdmp:eval(fn:concat("xdmp:directory-delete('",$uri,"')"),(),
     <options xmlns="xdmp:eval">
       <database>{xdmp:database($db)}</database>
     </options>
   )
};
declare function eval:directory-properties($uri,$db)
{
   xdmp:eval(fn:concat("xdmp:directory-properties('",$uri,"')"),(),
     <options xmlns="xdmp:eval">
       <database>{xdmp:database($db)}</database>
     </options>
   )
};
declare function eval:get-file-count($uri,$db)
{
   let $stmt := 
   '
     declare variable $uri as xs:string external;
     xdmp:estimate(cts:search(fn:doc(),cts:directory-query($uri,"1")))
   '
   return
      xdmp:eval($stmt,
      (xs:QName("uri"),$uri),
      <options xmlns="xdmp:eval">
        <database>{xdmp:database($db)}</database>
      </options>)
};
declare function eval:estimate($query,$db)
{
  let $stmt := 
  '
   declare variable $query as cts:query external;
   xdmp:estimate(cts:search(fn:collection(),$query))
  '
  return 
      xdmp:eval($stmt,
      (xs:QName("query"),$query),
      <options xmlns="xdmp:eval">
        <database>{xdmp:database($db)}</database>
      </options>)
};

declare function eval:estimate(
    $query as xs:string,
    $xpath as xs:string,
    $nses as xs:string,
    $db as xs:string
) {
  let $stmt := 
    fn:string(<stmt>
      declare variable $query as xs:string external;
      declare variable $nses as xs:string external;
      xdmp:with-namespaces(
        fn:tokenize($nses,"\|\|"),
        xdmp:estimate(cts:search({$xpath},xdmp:value($query)))
      )
    </stmt>)
  return 
      xdmp:eval($stmt,
      (xs:QName("query"),$query,
       xs:QName("nses"),$nses
      ),
      <options xmlns="xdmp:eval">
        <database>{xdmp:database($db)}</database>
      </options>)
     
};
declare function eval:get-deep-count($uri,$db)
{
  let $stmt := 
   '
     declare variable $uri as xs:string external;
     xdmp:estimate(cts:search(fn:doc(),cts:directory-query($uri,"infinity")))
   '
   return
      xdmp:eval($stmt,
      (xs:QName("uri"),$uri),
      <options xmlns="xdmp:eval">
        <database>{xdmp:database($db)}</database>
      </options>)

};
declare function eval:uris($start,$options,$query,$db)
{ 
   let $stmt := 
      'declare variable $start as xs:string external;
       declare variable $options as xs:string external;
       declare variable $query external;
       cts:uris($start,xdmp:value($options),$query)
      '
   return
     xdmp:eval($stmt,
       (xs:QName("start"),$start,
        xs:QName("options"),xdmp:describe($options,(),()),
        xs:QName("query"),$query
       ),
     <options xmlns="xdmp:eval">
         <database>{xdmp:database($db)}</database>
     </options>   
   )
       
};
declare function eval:uri-match($uri,$db)
{
    xdmp:eval(fn:concat("cts:uri-match('",$uri,"')"),(),
     <options xmlns="xdmp:eval">
       <database>{xdmp:database($db)}</database>
     </options>
   )     
};

declare function eval:search(
  $prefix-namespace as xs:string*,
  $xpath as xs:string,
  $query as cts:query,
  $db as xs:string
)
{
  eval:search($prefix-namespace,$xpath,$query,$db)
};

declare function eval:search(
  $prefix-namespace as xs:string*,
  $xpath as xs:string,
  $query as cts:query,
  $options as xs:string*,
  $db as xs:string)
{
  let $hdr  := "" (:
    fn:string-join((
       'xquery version "1.0-ml";',
       for $set at $pos in $prefix-namespace 
       return if($pos mod 2) then 
          fn:concat("declare namespace ", $prefix-namespace[$pos - 1], " = '", $set, "';")
       ) ," "):)
  let $stmt := fn:concat(
     "cts:search(",$xpath,", ",$query,",",xdmp:describe($options,(),()),")"
  )
  return
    xdmp:eval($stmt,
        (),
        <options xmlns="xdmp:eval">
           <database>{xdmp:database($db)}</database>
        </options>
    )
};