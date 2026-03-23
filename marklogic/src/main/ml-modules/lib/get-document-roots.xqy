xquery version "1.0-ml";
(: XQuery main module :)
declare namespace a = "urn:test";
declare default function namespace "urn:local";
declare default element namespace "http://marklogic.com/content-analyzer";
declare namespace filter = "http://marklogic.com/filter";

declare variable $DATABASE as xs:string external := "Documents";
declare variable $INCLUDE-BINARIES as xs:boolean external := fn:false();
declare variable $PATH-EXPRESSION external := "";
declare variable $CONSTRAINT-QUERY external;

declare variable $MAX-ITERATIONS as xs:integer  := 100;
declare variable $base-constraint := 
  try {cts:query($CONSTRAINT-QUERY)} catch($ex) {cts:and-query(())};
declare variable $bcount := 0;

(:~
 : Return a list of JSON Object where object at root is defined by a key 
~:)
declare function a:get-root-objects($bdone,$qnames,$results) {
  xdmp:set($bcount,$bcount + 1),
  if($bdone or $bcount > $MAX-ITERATIONS) then
  (
    xdmp:log(fn:concat("Starting JSON Frequency:", xdmp:elapsed-time()),"debug"),
    for $k in $results
    let $local-name := $k
    let $frequency := 
       xdmp:eval(
            fn:concat("declare variable $base-constraint external;xdmp:estimate(cts:search(fn:doc()[object-node('",$local-name,"')],($base-constraint),('unfiltered')))"),
            (fn:QName("","base-constraint"),$base-constraint)        
            ) 
    return
      <root-element>
        <type>json</type>
        <database>{$DATABASE}</database>
        <id>{xdmp:md5($k)}</id>
        <namespace></namespace>
        <localname>{$k}</localname>
        <frequency>{$frequency}</frequency>
        <constraint>{$base-constraint}</constraint>
      </root-element>,
    xdmp:log(fn:concat("Finished JSON Frequency:",xdmp:elapsed-time()),"debug")
  )
  else 
    let $constraint := 
      if(fn:exists($qnames)) then 
        for $qn in $qnames 
        return cts:not-query(cts:json-property-scope-query($qn,cts:true-query()))
      else ()
    let $rnode :=       
        if(fn:not(fn:empty($qnames))) 
        then cts:search(fn:doc()[object-node()],cts:and-query(($base-constraint,$constraint)),"unfiltered")[1]/object-node()/object-node()[1]
        else cts:search(fn:doc()[object-node()],cts:and-query(()),"unfiltered")[1]/object-node()/object-node()[1]
    return
        if($rnode instance of object-node() and fn:not(fn:local-name-from-QName(fn:node-name($rnode)) = $qnames)) then
            let $qname := fn:string(fn:node-name($rnode))
            let $key := fn:concat(fn:node-name($rnode))
            return (
                a:get-root-objects(fn:false(),($qnames,$qname),($key,$results))
            )
        else if(fn:node-name($rnode) = $qnames) then 
            a:get-root-objects(fn:true(),$qnames,$results)
        else if(fn:empty($rnode)) then
            a:get-root-objects(fn:true(),$qnames,$results)
        else 
           a:get-root-objects(fn:false(),$qnames,$results)
  
};
(:~
 : Iterates recursively over root elements, applying any constraints
~:)
declare function a:get-root-elements($bdone,$qnames,$results) {
   xdmp:set($bcount,$bcount + 1),
   if($bdone or $bcount > $MAX-ITERATIONS) then (
     xdmp:log(fn:concat("Starting XML Frequency:",xdmp:elapsed-time()),"debug"),
     for $k in $results
     let $parts := fn:analyze-string($k,"\{(.*)\}(.*)")
     let $ns := fn:string($parts/*:match/*:group[@nr eq 1])
     let $local-name := fn:string($parts/*:match/*:group[@nr eq 2])
     let $frequency  :=
        if($ns eq "") 
        then xdmp:eval(
            fn:concat("declare variable $base-constraint external;xdmp:estimate(cts:search(/",$local-name,",($base-constraint),('unfiltered')))"),
            (fn:QName("","base-constraint"),$base-constraint)        
            ) 
        else xdmp:eval(
            fn:concat("declare namespace _1  = """,$ns,""";
                       declare variable $base-constraint external;
                       xdmp:estimate(cts:search(/_1:",$local-name,",$base-constraint))"),
            (fn:QName("","base-constraint"),$base-constraint)
            )
     where $frequency > 0
     return (
      <root-element>
        <type>element</type>
        <database>{$DATABASE}</database>
        <id>{xdmp:md5($k)}</id>
        <namespace>{$ns}</namespace>
        <localname>{$local-name}</localname>
        <frequency>{$frequency}</frequency>
        <constraint>{$base-constraint}</constraint>
      </root-element>
      ),
     xdmp:log(fn:concat("Finished Root Frequency:",xdmp:elapsed-time()),"debug")
)
else 
    let $constraint := 
      if(fn:exists($qnames))  
      then for $qn in $qnames return cts:not-query(cts:element-query($qn,cts:and-query(())))
      else ()
    let $rnode :=       
        if(fn:not(fn:empty($qnames))) 
        then cts:search(fn:doc()/element(),cts:and-query(($base-constraint,$constraint)),"unfiltered")[1]
        else cts:search(/element(),cts:and-query(()),"unfiltered")[1]
    return
        if($rnode instance of element() and fn:not(fn:node-name($rnode) = $qnames)) then
            let $qname := fn:node-name($rnode)
            let $key := fn:concat("{",fn:namespace-uri($rnode),"}",fn:local-name($rnode))
            return (
                a:get-root-elements(fn:false(),($qnames,$qname),($key,$results))
            )
        else if(fn:node-name($rnode) = $qnames) then 
            a:get-root-elements(fn:true(),$qnames,$results)
        else if(fn:empty($rnode)) then
            a:get-root-elements(fn:true(),$qnames,$results)
        else 
           a:get-root-elements(fn:false(),$qnames,$results)
};

declare function a:get-binary-nodes($bdone,$content-types,$results)
{
if($bdone) then
  for $k in $results
  let $parts := fn:analyze-string($k,"\{(.*)\}(.*)")
  let $ns := fn:string($parts/*:match/*:group[@nr eq 1])
  let $local-name := fn:string($parts/*:match/*:group[@nr eq 2])
  return
   <root-element>
   <type>binary</type>
   <database>{$DATABASE}</database>
   <id>{xdmp:md5($k)}</id>
   <namespace>{$ns}</namespace>
   <localname>{$local-name}</localname>
   <frequency>{
     xdmp:estimate(cts:search(fn:doc()[binary()],cts:and-query((
        cts:properties-query(
           cts:element-value-query(xs:QName("filter:content-type"),$local-name)
        )
     ))
     ))
   }</frequency>

   </root-element>
else 
 
let $rnode :=
       if(fn:not(fn:empty($content-types))) then
           cts:search(fn:collection()[binary()],
               cts:properties-query(
                  cts:and-query((
                   cts:not-query(cts:element-value-query(xs:QName("filter:content-type"),$content-types)
               )))),"unfiltered")[1]/property::filter:content-type
         else 
          (/binary()[property::filter:content-type])[1]/property::filter:content-type
return 
      if($rnode instance of element()) then
          let $key := fn:concat("{binary()}",$rnode)
          return
            (
             a:get-binary-nodes(fn:false(),($content-types,$rnode),($key,$results))
            )
      else if(fn:empty($rnode)) then
          a:get-binary-nodes(fn:true(),$content-types,$results)
      else 
         a:get-binary-nodes(fn:true(),$content-types,$results)
};

declare function a:get-binary-documents()
{
     xdmp:log("Starting Binary Roots","debug"),
     if(xdmp:estimate(/binary()) gt 0) then
        for $re in a:get-binary-nodes(fn:false(),(),())
        order by $re/localname
        return $re
     else (),
     xdmp:log("Finished Binary Roots","debug")

};
document {
  <root-elements>
  {
  for $re in a:get-root-elements(fn:false(),(),())
  order by $re/localname
  return 
  $re,
  for $obj in a:get-root-objects(fn:false(),(),())
  return
      $obj,
  if($INCLUDE-BINARIES) then a:get-binary-documents() else ()
  }
  </root-elements>},
xdmp:log(fn:concat("Document Roots Completed:",xdmp:elapsed-time()),"debug")
    
