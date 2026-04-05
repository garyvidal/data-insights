xquery version "1.0-ml";
(:~
 : Given a set of document uris will recursively descend each document and create document statistics.
 : The task supports passing in previous analysis to be merged with current analysis.  
 :)
declare default function namespace "urn:local";

declare default element namespace "http://marklogic.com/content-analyzer";  

declare namespace a = "urn:test";
(:~
 : External Variables Passed from User
~:)
(:~
 : The database for which the document is located.
~:)
declare variable $_DATABASE as xs:string  external;
(:~
 : Is the list of uris for which the analysis will execute against.
~:)
declare variable $_URIS as map:map  external := map:map();

(:~
 : Any Existing analysis data to be merged with the results
~:)
declare variable $_MERGEDATA as map:map external := map:map(); (:Is existing map of maps data that will be used from a previously analysis:)

(:~
 : Defines which keys from maps will be merged back into the result set.
~:)
declare variable $DATA-KEYS := (
    "ELEMENT_COUNT",
    "NS_COUNTER",
    
    "DOCUMENT_SIZE",
    "DOCUMENT_URIS",
    
    "ELEMENT_FREQUENCY",
    "ELEMENT_VALUES",
    "ELEMENT_XPATHS",
    
    "ELEMENT_ATTRIBUTE_FREQUENCY",
    "ELEMENT_ATTRIBUTE_VALUES",
    "ELEMENT_ATTRIBUTE_XPATHS",
    
    "ELEMENT_CHILD_DISTANCE",
    "ELEMENT_CHILD_FREQUENCY",
    "ELEMENT_CHILD_VALUES",
    "ELEMENT_CHILD_XPATHS",

    "ATTRIBUTE_FREQUENCY",
    "ATTRIBUTE_VALUES",
    "ATTRIBUTE_XPATHS",
    
    "NAMESPACE_PREFIX",
    "NAMESPACE_VALUES",
    
    "VALUE_COUNTER",
    "VALUE_KEY"
);

declare variable $ELEMENT_COUNT                := 0;
declare variable $NS_COUNTER                   := 0;

declare variable $DOCUMENT_SIZE                := map:map();
declare variable $DOCUMENT_URIS                := map:map();

declare variable $ELEMENT_FREQUENCY            := map:map();
declare variable $ELEMENT_VALUES               := map:map();
declare variable $ELEMENT_XPATHS               := map:map();

declare variable $ELEMENT_CHILD_FREQUENCY      := map:map();
declare variable $ELEMENT_CHILD_DISTANCE       := map:map();
declare variable $ELEMENT_CHILD_VALUES         := map:map();
declare variable $ELEMENT_CHILD_XPATHS         := map:map();

declare variable $ELEMENT_ATTRIBUTE_FREQUENCY  := map:map();
declare variable $ELEMENT_ATTRIBUTE_VALUES     := map:map();
declare variable $ELEMENT_ATTRIBUTE_XPATHS     := map:map();

declare variable $ATTRIBUTE_FREQUENCY          := map:map();
declare variable $ATTRIBUTE_VALUES             := map:map();
declare variable $ATTRIBUTE_XPATHS             := map:map();

declare variable $VALUE_KEY                  := map:map();
declare variable $VALUE_COUNTER                := map:map();

declare variable $NAMESPACE_PREFIX             := map:map();
declare variable $NAMESPACE_VALUES             := map:map();

(:~~:)
declare variable $NS_PREFIX                    := "ns";

(:~
 : Used to represent the an empty value.
~:)
declare variable $EMPTY_VALUE                  := "xsi:nilled";
(:~
 : Used to represent a mixed value
~:)
declare variable $MIXED_VALUE                  := "##MIXED##";
(:~
 : Used to denote the the element is a complex-type
~:)
declare variable $COMPLEX_VALUE                := "xs:complexType";

(:~ 
 : Determines what joiners are used to compose keys
 :)
declare variable $ELEMENT_CHILD_JOINER  := "!";
declare variable $ATTRIBUTE_JOINER := "@";
declare variable $ELEMENT_NS_JOINER := "~";
declare variable $VALUE_JOINER := "==";

(:Use Matchers as a better pattern:)
declare variable $PATTERN-SQLDATE := 
  "(15|16|17|18|19|20)\d{2}\-(0[0-9]|1[0-2])\-(0[1-9]|1[0-9]|2[0-9]|3[0-1])\s[0-5][0-9]:[0-5][0-9]:[0-5][0-9](\.d{1,5})?";
  
declare variable $NUMERIC_TYPES := ("xs:integer","xs:long","xs:float","xs:decimal","xs:double","xs:unsignedLong","xs:unsignedInteger"); 

(:~
 : Infers a list of values.
~:)
declare function a:infer-types($values)
{
   let $is_integer  := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:integer
   let $is_float    := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:float
   let $is_double   := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:double
   let $is_decimal  := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:decimal
   let $is_long     := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:long 
   let $is_boolean  := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v = ("0","1","true","false","True","False","Yes","No")   
   
   let $is_dateTime   := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:dateTime
   let $is_date       := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:date
   let $is_time       := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:time 
   let $is_shortTime  := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies fn:matches($v,"^\d\d:\d\d^")
   let $sql_dateTime  := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies fn:matches($v,$PATTERN-SQLDATE)
   
   (:Do durations:)                                                                             
   let $is_gYear      := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:gYear
   let $is_gYearMonth := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:gYearMonth
   let $is_gMonth     := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:gMonth
   let $is_gMonthDay  := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:gMonthDay
   let $is_gDay       := every $v in $values[fn:not(. eq $EMPTY_VALUE)] satisfies $v castable as xs:gDay
   
   let $is_duration := every $v in $values[fn:not(. eq $EMPTY_VALUE)]   satisfies $v castable as xs:duration
   
   let $is_anyUri := every $v in $values satisfies $v castable as xs:anyURI
   let $is_complex := some $v in $values satisfies $v  eq $COMPLEX_VALUE   
   let $is_empty := every $v in $values satisfies $v eq $EMPTY_VALUE
   let $is_mixed := some $v in $values satisfies $v eq $MIXED_VALUE
   return
     (
       if($is_empty)          then $EMPTY_VALUE
       else if($is_mixed)     then $MIXED_VALUE 
       else if($is_complex)   then $COMPLEX_VALUE
       (:Resolve Types:)
       else if($is_integer)   then "xs:integer"
       else if($is_float)     then "xs:float"
       else if($is_double)    then "xs:double"
       else if($is_decimal)   then "xs:decimal"       
       else if($is_dateTime)  then "xs:dateTime" 
       else if($is_date)      then "xs:date" 
       else if($is_time)      then "xs:time" 
       else if($is_shortTime) then "sql:shortTime"
       else if($sql_dateTime) then "sql:dateTime" 
       else if($is_duration)  then "xs:duration" 
       else if($is_boolean)   then "xs:boolean"
       else "xs:string"
     )
};

(:~
 : Removes any positional predicates from xdmp:path.
~:)
declare function a:clean-xpath($path)
{
   fn:replace($path,"\[\d+\]","")   
};
(:~
 : Resolves a prefix for a given node. If the node has a prefix associated.
~:)
declare function a:resolve-prefix($node)
{
    let $ns := fn:namespace-uri($node)
    let $prefix := fn:prefix-from-QName(fn:node-name($node))
    let $prefix := 
        fn:normalize-space(if($prefix eq "" or fn:empty($prefix)) 
        then fn:in-scope-prefixes($node)[fn:namespace-uri-for-prefix(.,$node) eq $ns][1]
        else $prefix)
    return
        if(fn:empty($prefix) or $prefix = "") then
           if($ns eq "") 
           then "*" 
           else (fn:concat($NS_PREFIX,fn:string($NS_COUNTER)),xdmp:set($NS_COUNTER,$NS_COUNTER + 1))
        else 
           $prefix
};
(:~
 : Registers the given namespace by prefix and namespace-uri
~:)
declare function a:register-namespace($prefix,$ns)
{
   ( map:put($NAMESPACE_VALUES,$ns,$ns),
     if(fn:exists(map:get($NAMESPACE_PREFIX,$ns))) then () else map:put($NAMESPACE_PREFIX, $ns, $prefix )
   )
};

declare function a:add-value($key as xs:string,$values as item()*) {
  let $value-map := map:map()
  let $_ := 
    for $value in $values
    let $value-key := $key || $VALUE_JOINER || $value
    return (
       map:put($VALUE_KEY,$value,$key),
       map:put($VALUE_COUNTER,$value-key,((map:get($VALUE_COUNTER,$value-key),0)[1] + 1))
    )
 
 return
   (
     xdmp:set($VALUE_KEY,$VALUE_KEY + $value-map)
   )
};
(:~
 : Gets the xpath for a given node using the scope of any inscope namespaces to ensure path provides correct prefix
 : Strips out namespaces that are automatically added to scope.
~:)
declare function a:get-node-xpath($node)
{
   let $prefix-map   := - $NAMESPACE_PREFIX
   let $nses  := 
       for $pfkey in map:keys($prefix-map)[fn:not(. = ("xsi","xml","xs","*"))]
       return
          if(map:get($prefix-map,$pfkey) = "")
          then ()
          else ($pfkey, map:get($prefix-map,$pfkey)[1])  
   return
      xdmp:with-namespaces(
        $nses,
        xdmp:path($node)
      )
};
(:~
 : Returns a node key similar to xdmp:key-from-QName
 :)
declare function a:node-key($node as node()) as xs:string {
  
  fn:concat(
    if(fn:namespace-uri($node) ne "") 
    then "{" || fn:namespace-uri($node) || "}" 
    else "",
    fn:local-name($node)
  )
  
};
(:~
 : Entry Function calls back into analyze
~:)
declare function a:analyze($node as node()) {
   typeswitch($node)   
     case element() return a:analyze-element($node)
     case document-node() return a:analyze($node/node())
     default return ()
};

(:~
 : Recursively descends a document structure collecting statistics about the structure.
~:)
declare function a:analyze-element($node as element())
{
   let $_ := xdmp:set($ELEMENT_COUNT,$ELEMENT_COUNT + 1)
   let $ns := fn:namespace-uri($node)
   let $prefix := a:resolve-prefix($node)
   let $map-key :=  a:node-key($node)(: fn:concat($ns,$ELEMENT_NS_JOINER,fn:local-name($node)):)
   let $_  := a:register-namespace($prefix,$ns)
   let $xpath := a:clean-xpath(a:get-node-xpath($node))
   let $_  := map:put($ELEMENT_XPATHS,$map-key,fn:distinct-values((map:get($ELEMENT_XPATHS,$map-key),$xpath)))
   let $node-content-type := 
         if($node/text()[fn:normalize-space(.) ne ""] and $node/element()) then "mixed"
         else if($node/element()) then "element-only"
         else if($node/text()) then "simple-content"
         else if(fn:empty($node/node())) then "empty"
         else ()
   let $root := 
       if(fn:not($node/parent::*)) then 
        let $pkey := fn:concat($ELEMENT_CHILD_JOINER, $map-key)
        return
        (
           map:put($ELEMENT_CHILD_FREQUENCY,$pkey,(map:get($ELEMENT_CHILD_FREQUENCY,$pkey),0)[1] + 1),
           for $pfx in fn:in-scope-prefixes($node) 
           let $pns := fn:namespace-uri-for-prefix($pfx,$node)
           return a:register-namespace($pfx,$pns)
        )
       else ()
   let $_ :=
      (
         map:put($ELEMENT_FREQUENCY,$map-key,((map:get($ELEMENT_FREQUENCY,$map-key),0)[1] +  1)),
        (:Attribute Values:)      
             for $attr in $node/@*
             let $ea-key := a:node-key($node) || $ATTRIBUTE_JOINER ||  a:node-key($attr) 
             let $av-key := $ATTRIBUTE_JOINER || a:node-key($attr) 
             let $attr-xpath := a:clean-xpath(a:get-node-xpath($attr))                     
             return (
                 map:put($ELEMENT_ATTRIBUTE_FREQUENCY,$ea-key,(map:get($ELEMENT_ATTRIBUTE_FREQUENCY,$ea-key),0)[1] + 1),
                 map:put($ELEMENT_ATTRIBUTE_VALUES,$ea-key,fn:distinct-values((map:get($ELEMENT_ATTRIBUTE_VALUES,$ea-key),fn:data($attr)))),
                 map:put($ELEMENT_ATTRIBUTE_XPATHS,$ea-key,fn:distinct-values((map:get($ELEMENT_ATTRIBUTE_XPATHS,$ea-key),$attr-xpath))),               
                 map:put($ATTRIBUTE_FREQUENCY,$av-key,(map:get($ATTRIBUTE_FREQUENCY,$av-key),0)[1] + 1),
                 map:put($ATTRIBUTE_VALUES,$av-key,fn:distinct-values((map:get($ATTRIBUTE_VALUES,$av-key),fn:data($attr)))),
                 map:put($ATTRIBUTE_XPATHS,$av-key,fn:distinct-values((map:get($ATTRIBUTE_XPATHS,$av-key),$attr-xpath))),
                 a:add-value($ea-key,fn:data($attr)),
                 a:add-value($av-key,fn:data($attr))
         ),
         switch($node-content-type)
           case "mixed" return (
            (:Mixed Values:)
            for $c at $pos in $node/element()
            let $child-key :=  fn:concat($map-key,$ELEMENT_CHILD_JOINER,a:node-key($c)) (:fn:concat($map-key,$ELEMENT_CHILD_JOINER,fn:namespace-uri($c),$ELEMENT_NS_JOINER,fn:local-name($c)):)
            let $_ := a:register-namespace(a:resolve-prefix($c),fn:namespace-uri($c))     
            return
              (
                 map:put($ELEMENT_CHILD_FREQUENCY,$child-key,(map:get($ELEMENT_CHILD_FREQUENCY,$child-key),0)[1] + 1),
                 map:put($ELEMENT_CHILD_DISTANCE,$child-key,fn:distinct-values((map:get($ELEMENT_CHILD_DISTANCE,$child-key),$pos))),
                 map:put($ELEMENT_CHILD_VALUES,$child-key,fn:distinct-values((map:get($ELEMENT_CHILD_VALUES,$child-key),$MIXED_VALUE))),
                 map:put($ELEMENT_CHILD_XPATHS,$child-key,fn:distinct-values((map:get($ELEMENT_CHILD_XPATHS,$child-key),$xpath)))
              ), 
              map:put($ELEMENT_VALUES,$map-key,fn:distinct-values((map:get($ELEMENT_VALUES,$map-key),$MIXED_VALUE))),
             a:add-value($map-key,$MIXED_VALUE)
         )
         case "element-only" return
         (
             (:Complex Relationships:) 
             for $c at $pos in $node/element()
             let $child-key := $map-key || $ELEMENT_CHILD_JOINER || a:node-key($c) (:fn:concat($map-key,$ELEMENT_CHILD_JOINER,fn:namespace-uri($c),$ELEMENT_NS_JOINER,fn:local-name($c)):)
             let $xpath := a:clean-xpath(a:get-node-xpath($c))
             let $_ := a:register-namespace(a:resolve-prefix($c),fn:namespace-uri($c))
             return (
                  map:put($ELEMENT_CHILD_FREQUENCY,$child-key,(map:get($ELEMENT_CHILD_FREQUENCY,$child-key),0)[1] + 1),
                  map:put($ELEMENT_CHILD_DISTANCE,$child-key,fn:distinct-values((map:get($ELEMENT_CHILD_DISTANCE,$child-key),$pos))),
                  map:put($ELEMENT_CHILD_XPATHS,$child-key,fn:distinct-values((map:get($ELEMENT_CHILD_XPATHS,$child-key),$xpath)))
              )
             , map:put($ELEMENT_VALUES,$map-key,fn:distinct-values((map:get($ELEMENT_VALUES,$map-key),$COMPLEX_VALUE)))
             , a:add-value($map-key,$COMPLEX_VALUE)
         )
         case "simple" return
             let $parent := $node/parent::*
             let $pkey   := a:node-key($parent) (: fn:concat($parent/fn:namespace-uri(.),$ELEMENT_NS_JOINER,$parent/fn:local-name(.),$ELEMENT_CHILD_JOINER,$map-key):)
             let $xpath := a:clean-xpath(a:get-node-xpath($parent))
             return 
             (
                   map:put($ELEMENT_VALUES,$pkey,(map:get($ELEMENT_VALUES,$pkey),fn:normalize-space($node/fn:string(.)))),
                   map:put($ELEMENT_CHILD_VALUES,$pkey,(map:get($ELEMENT_CHILD_VALUES,$pkey),fn:normalize-space($node/fn:string(.)))),
                   map:put($ELEMENT_CHILD_XPATHS,$pkey,(map:get($ELEMENT_CHILD_XPATHS,$pkey),$xpath)),
                  a:add-value($pkey,fn:data($node))                   
             )
         case "empty" return
         (
              map:put($ELEMENT_VALUES,$map-key,(map:get($ELEMENT_VALUES,$map-key),$EMPTY_VALUE)),
              a:add-value($map-key,$EMPTY_VALUE)
         )  
         default return ()          
     )
   return
     for $n in $node/element()
     return
       a:analyze($n)
};
(:~
 : Calculates the size of a given document by getting the string length
~:)
declare function a:document-stat($node as node())
{
   let $uri  := xdmp:node-uri($node) 
   let $size := fn:string-length(xdmp:quote($node))
   return 
      map:put($DOCUMENT_SIZE,$uri,$size)
};
(:~
 : Unwraps any existing map:map data passed in from caller
~:)
declare function a:unwrap-mergedata() {
    for $dk in $DATA-KEYS
    let $key-join := "$" || $dk
    return xdmp:value("
     xdmp:set($key-join,  
       if(map:get($_MERGEDATA,$dk) instance of map:map) 
       then $key-join  + map:get($_MERGEDATA,$dk) 
       else map:map()

    )")
};

(:~
 : Merges back all the map data from all data maps into a single map:map
~:)
declare function a:wrap-mergedata() {
    let $merge := map:map()
    let $_ := 
        for $dk in $DATA-KEYS
        let $key-join := "$" || $dk
        return map:put($merge,$dk, xdmp:value($key-join))
    return 
     $merge
};

let $stmt := 
  "declare variable $uris as map:map external;
   cts:search(fn:doc(),cts:document-query(map:keys($uris)))
  "
let $docs := 
    xdmp:eval($stmt,
    (fn:QName("","uris"),$_URIS),
     <options xmlns="xdmp:eval">
       <database>{xdmp:database($_DATABASE)}</database>
     </options>
    )
return (
    a:unwrap-mergedata(),
    for $doc in $docs return (a:document-stat($doc),a:analyze($doc)),   
    a:wrap-mergedata()
)  
