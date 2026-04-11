(:fn:doc("/flows/unmerge-mastering.flow.json"):)
xquery version "1.0-ml";

declare default function namespace "urn:local";

declare default element namespace "http://marklogic.com/content-analyzer";  

declare namespace a = "urn:local";

declare variable $_callback-db as xs:string external := "foo";
declare variable $_database as xs:string  external := "data-insight-content";
declare variable $_name as xs:string external := "foo";
declare variable $_root-element as element(root-element) external := <root-element>
    <type>json</type>
    <database>data-hub-STAGING</database>
    <id>caf9b6b99962bf5c2264824231d7a40c</id>
    <namespace>
    </namespace>
    <localname>info</localname>
    <frequency>2</frequency>
    <constraint>
    <cts:and-query xmlns:cts="http://marklogic.com/cts">
    </cts:and-query>
    </constraint>
    </root-element>;
declare variable $_sample as xs:integer external := 1;
declare variable $_ticket as xs:integer external := 123;
declare variable $_constraint as xs:string external := "cts:and-query(())";
declare variable $_xpath as xs:string external := "";
declare variable $_namespaces as element(namespace-list)? external :=();

declare variable $NS-LIST := 
    $_namespaces/*:namespace/(*:prefix|*:namespace-uri)/fn:string(fn:normalize-space(.));
    
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

declare variable $ELEMENT_NODE_KIND            := map:map();

declare variable $ATTRIBUTE_FREQUENCY          := map:map();
declare variable $ATTRIBUTE_VALUES             := map:map();
declare variable $ATTRIBUTE_XPATHS             := map:map();

declare variable $VALUE_QNAME                  := map:map();

declare variable $NAMESPACE_PREFIX             := map:map();
declare variable $NAMESPACE_VALUES             := map:map();



declare variable $NS_PREFIX                    := "ns";
declare variable $EMPTY_VALUE                  := "xsi:nilled";
declare variable $MIXED_VALUE                  := "##MIXED##";
declare variable $COMPLEX_VALUE                := "xs:complexType";

declare variable $ELEMENT_CHILD_JOINER  := "~~~";
declare variable $ATTRIBUTE_JOINER := "@@@";
declare variable $ELEMENT_NS_JOINER := "###";

(:Use Matchers as a better pattern:)
declare variable $PATTERN-SQLDATE := 
  "(15|16|17|18|19|20)\d{2}\-(0[0-9]|1[0-2])\-(0[1-9]|1[0-9]|2[0-9]|3[0-1])\s[0-5][0-9]:[0-5][0-9]:[0-5][0-9](\.d{1,5})?";
  
declare variable $NUMERIC_TYPES := ("xs:integer","xs:long","xs:float","xs:decimal","xs:double","xs:unsignedLong","xs:unsignedInteger"); 

declare function a:infer-types($values)
{
  let $non-empty := $values[fn:not(. eq $EMPTY_VALUE)]
  return
    if      (every $v in $values    satisfies $v eq $EMPTY_VALUE)   then $EMPTY_VALUE
    else if (some  $v in $values    satisfies $v eq $MIXED_VALUE)   then $MIXED_VALUE
    else if (some  $v in $values    satisfies $v eq $COMPLEX_VALUE) then $COMPLEX_VALUE
    else if (every $v in $non-empty satisfies $v castable as xs:integer)  then "xs:integer"
    else if (every $v in $non-empty satisfies $v castable as xs:decimal)  then "xs:decimal"
    else if (every $v in $non-empty satisfies $v castable as xs:float)    then "xs:float"
    else if (every $v in $non-empty satisfies $v castable as xs:double)   then "xs:double"
    else if (every $v in $non-empty satisfies $v castable as xs:dateTime) then "xs:dateTime"
    else if (every $v in $non-empty satisfies $v castable as xs:date)     then "xs:date"
    else if (every $v in $non-empty satisfies $v castable as xs:time)     then "xs:time"
    else if (every $v in $non-empty satisfies fn:matches($v,"^\d\d:\d\d^"))    then "sql:shortTime"
    else if (every $v in $non-empty satisfies fn:matches($v,$PATTERN-SQLDATE)) then "sql:dateTime"
    else if (every $v in $non-empty satisfies $v castable as xs:duration) then "xs:duration"
    else if (every $v in $non-empty satisfies $v = ("0","1","true","false","True","False","Yes","No")) then "xs:boolean"
    else "xs:string"
};

declare function a:analyze($node as node())
{
   typeswitch($node)   
     case document-node() return a:analyze($node/node())
     case element() return a:analyze-element($node)
     case object-node() return a:analyze-json($node)
     case array-node() return a:analyze-json($node)
     default return ()
};

declare function a:clean-xpath($path)
{
   fn:replace($path,"\[\d+\]","")   
};

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

declare function a:register-namespace($prefix,$ns)
{
   ( map:put($NAMESPACE_VALUES,$ns,$ns),
     if(fn:exists(map:get($NAMESPACE_PREFIX,$ns))) then () else map:put($NAMESPACE_PREFIX, $ns, $prefix )
   )
};

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
declare function a:analyze-json($objects as node()*) {
  for $object in $objects
  let $obj-raw := fn:string(fn:name($object))
  let $obj-key := fn:concat("",$ELEMENT_NS_JOINER,$obj-raw)
  return
    typeswitch($object)
     case document-node() return
     (:We need to determine if the root is a JSON object or array:)
      let $_ := 
        if(fn:node-name($object/node()) eq "object-node") 
        then 
          let $obj-key := fn:concat("",$ELEMENT_NS_JOINER,"object") 
          let $xpath := a:clean-xpath(xdmp:path($object/node()))
          let $_ := $ELEMENT_FREQUENCY=>map:put($obj-key, ($ELEMENT_FREQUENCY=>map:get($obj-key),0)[1] + 1)
          return a:analyze-json($object/node())
        else 
          let $obj-key := fn:concat("",$ELEMENT_NS_JOINER,"array")
          return a:analyze-json($object/node())
      return a:analyze-json($object/node())
     case object-node() | array-node() return
        for $prop at $pos in $object/node()
        let $propname := fn:string(fn:name($prop))
        let $prop-key := fn:concat("",$ELEMENT_NS_JOINER,$propname)
        let $propkey  := fn:concat($obj-key,$ELEMENT_CHILD_JOINER,$prop-key)
        let $xpath    := a:clean-xpath(xdmp:path($prop))
        let $_ := $ELEMENT_CHILD_FREQUENCY=>map:put($propkey, ($ELEMENT_CHILD_FREQUENCY=>map:get($propkey),0)[1] + 1)
        let $_ := $ELEMENT_CHILD_DISTANCE=>map:put($propkey,($ELEMENT_CHILD_DISTANCE=>map:get($propkey),$pos))
        let $_ := $ELEMENT_CHILD_XPATHS=>map:put($propkey, ($ELEMENT_CHILD_XPATHS=>map:get($propkey),$xpath))
        let $_ := $ELEMENT_FREQUENCY=>map:put($prop-key, ($ELEMENT_FREQUENCY=>map:get($prop-key),0)[1] + 1)
        let $_ := $ELEMENT_XPATHS=>map:put($prop-key, ($ELEMENT_XPATHS=>map:get($prop-key),$xpath))
        return
          if($prop instance of object-node())
          then (
            map:put($ELEMENT_VALUES,$prop-key,($ELEMENT_VALUES=>map:get($prop-key),xdmp:node-kind($prop))),
            map:put($ELEMENT_NODE_KIND,$prop-key,"object-node"),
            a:analyze-json($prop)
          ) else if($prop instance of array-node())
          then (
            map:put($ELEMENT_VALUES,$prop-key,($ELEMENT_VALUES=>map:get($prop-key),xdmp:node-kind($prop))),
            map:put($ELEMENT_NODE_KIND,$prop-key,"array-node"),
            a:analyze-json($prop)
          )
          else
            let $value := fn:normalize-space(fn:string($prop))
            let $_ := $ELEMENT_CHILD_VALUES=>map:put($propkey, ($ELEMENT_CHILD_VALUES=>map:get($propkey), $value))
            let $_ := $ELEMENT_VALUES=>map:put($prop-key, ($ELEMENT_VALUES=>map:get($prop-key), $value))
            return ()
      default return ()

};
(:~
 :
~:)
declare function a:analyze-element($node as node())
{
   let $_ := xdmp:set($ELEMENT_COUNT,$ELEMENT_COUNT + 1)
   let $ns := fn:namespace-uri($node)
   let $prefix := a:resolve-prefix($node)
   let $map-key := fn:concat($ns,$ELEMENT_NS_JOINER,fn:local-name($node))
   let $_  := a:register-namespace($prefix,$ns)
   let $xpath := a:clean-xpath(a:get-node-xpath($node))
   let $_  := map:put($ELEMENT_XPATHS,$map-key,(map:get($ELEMENT_XPATHS,$map-key),$xpath))

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
         if($node/attribute::*) then
             for $attr in $node/@*
             let $ea-key := fn:concat($map-key,$ATTRIBUTE_JOINER,fn:namespace-uri($attr),$ELEMENT_NS_JOINER,fn:local-name($attr))
             let $av-key := fn:concat($ATTRIBUTE_JOINER,fn:namespace-uri($attr),$ELEMENT_NS_JOINER,fn:local-name($attr))
             let $xpath := a:clean-xpath(a:get-node-xpath($attr))                     
             return (
                 map:put($ELEMENT_ATTRIBUTE_FREQUENCY,$ea-key,(map:get($ELEMENT_ATTRIBUTE_FREQUENCY,$ea-key),0)[1] + 1),
                 map:put($ELEMENT_ATTRIBUTE_VALUES,$ea-key,(map:get($ELEMENT_ATTRIBUTE_VALUES,$ea-key),fn:normalize-space(fn:string($attr)))),
                 map:put($ELEMENT_ATTRIBUTE_XPATHS,$ea-key,(map:get($ELEMENT_ATTRIBUTE_XPATHS,$ea-key),$xpath)),                 
                 map:put($ATTRIBUTE_FREQUENCY,$av-key,(map:get($ATTRIBUTE_FREQUENCY,$av-key),0)[1] + 1),
                 map:put($ATTRIBUTE_VALUES,$av-key,(map:get($ATTRIBUTE_VALUES,$av-key),fn:normalize-space(fn:string($attr)))),
                 map:put($ATTRIBUTE_XPATHS,$av-key,(map:get($ATTRIBUTE_XPATHS,$av-key),$xpath))
             )
         else (),
         if($node/element() and $node/text()[fn:not(fn:normalize-space(.) = "")]) then 
         (
            (:Mixed Values:)
            for $c at $pos in $node/child::element()
            let $child-key := fn:concat($map-key,$ELEMENT_CHILD_JOINER,fn:namespace-uri($c),$ELEMENT_NS_JOINER,fn:local-name($c))
            let $_ := a:register-namespace(a:resolve-prefix($c),fn:namespace-uri($c))     
            return
              (
                 map:put($ELEMENT_CHILD_FREQUENCY,$child-key,(map:get($ELEMENT_CHILD_FREQUENCY,$child-key),0)[1] + 1),
                 map:put($ELEMENT_CHILD_DISTANCE,$child-key,(map:get($ELEMENT_CHILD_DISTANCE,$child-key),$pos)),
                 map:put($ELEMENT_CHILD_VALUES,$child-key,(map:get($ELEMENT_CHILD_VALUES,$child-key),$MIXED_VALUE)),
                 map:put($ELEMENT_CHILD_XPATHS,$child-key,(map:get($ELEMENT_CHILD_XPATHS,$child-key),$xpath))
              ), 
              map:put($ELEMENT_VALUES,$map-key,(map:get($ELEMENT_VALUES,$map-key),$MIXED_VALUE))
         )
         else if($node/child::element()) then 
         (
             (:Complex Relationships:) 
             for $c at $pos in $node/child::element()
             let $child-key := fn:concat($map-key,$ELEMENT_CHILD_JOINER,fn:namespace-uri($c),$ELEMENT_NS_JOINER,fn:local-name($c))
             let $xpath := a:clean-xpath(a:get-node-xpath($c))
             let $_ := a:register-namespace(a:resolve-prefix($c),fn:namespace-uri($c))
             return (
                  map:put($ELEMENT_CHILD_FREQUENCY,$child-key,(map:get($ELEMENT_CHILD_FREQUENCY,$child-key),0)[1] + 1),
                  map:put($ELEMENT_CHILD_DISTANCE,$child-key,(map:get($ELEMENT_CHILD_DISTANCE,$child-key),$pos)),
                  map:put($ELEMENT_CHILD_XPATHS,$child-key,(map:get($ELEMENT_CHILD_XPATHS,$child-key),$xpath))
              )
             , map:put($ELEMENT_VALUES,$map-key,(map:get($ELEMENT_VALUES,$map-key),$COMPLEX_VALUE))
         )
         else if($node/text()) then 
            (:Simple Value Type:) (:Invert the key so that it gets the right value:)
             let $parent := $node/parent::*
             let $pkey   := fn:concat($parent/fn:namespace-uri(.),$ELEMENT_NS_JOINER,$parent/fn:local-name(.),$ELEMENT_CHILD_JOINER,$map-key)
             let $xpath := a:clean-xpath(a:get-node-xpath($parent))
             return 
             (
                   map:put($ELEMENT_VALUES,$pkey,(map:get($ELEMENT_VALUES,$pkey),fn:normalize-space($node/fn:string(.)))),
                   map:put($ELEMENT_CHILD_VALUES,$pkey,(map:get($ELEMENT_CHILD_VALUES,$pkey),fn:normalize-space($node/fn:string(.)))),
                   map:put($ELEMENT_CHILD_XPATHS,$pkey,(map:get($ELEMENT_CHILD_XPATHS,$pkey),$xpath))                   
             )
         else if(fn:empty($node/node())) then 
           (
              map:put($ELEMENT_VALUES,$map-key,(map:get($ELEMENT_VALUES,$map-key),$EMPTY_VALUE))
           )  
         else (),
         if($node/object-node()) then
          (
             (:Complex Relationships:) 
             for $c at $pos in $node/child::object-node()
             let $child-key := fn:concat($map-key,$ELEMENT_CHILD_JOINER,fn:namespace-uri($c),$ELEMENT_NS_JOINER,fn:local-name($c))
             let $xpath := a:clean-xpath(a:get-node-xpath($c))
             return (
                  map:put($ELEMENT_CHILD_FREQUENCY,$child-key,(map:get($ELEMENT_CHILD_FREQUENCY,$child-key),0)[1] + 1),
                  map:put($ELEMENT_CHILD_DISTANCE,$child-key,(map:get($ELEMENT_CHILD_DISTANCE,$child-key),$pos)),
                  map:put($ELEMENT_CHILD_XPATHS,$child-key,(map:get($ELEMENT_CHILD_XPATHS,$child-key),$xpath))
              )
             , map:put($ELEMENT_VALUES,$map-key,(map:get($ELEMENT_VALUES,$map-key),$COMPLEX_VALUE))
         )
         else ()            
     )
   return
     for $n in $node/node()
     return
       a:analyze($n)
};
declare function a:document-stat($node as node())
{
   let $uri  := xdmp:node-uri($node) 
   let $size := fn:string-length(xdmp:quote($node))
   return 
      map:put($DOCUMENT_SIZE,$uri,$size)
};

declare function a:analyze-documents($node,$root-key)
{
let $root-key := xdmp:md5(fn:string($root-key/id))
let $_ :=
   (
     map:clear($ELEMENT_FREQUENCY),          
     map:clear($ELEMENT_VALUES),               
     map:clear($ELEMENT_CHILD_FREQUENCY),      
     map:clear($ELEMENT_CHILD_DISTANCE),   
     map:clear($ELEMENT_CHILD_VALUES),     
     map:clear($ELEMENT_ATTRIBUTE_FREQUENCY),  
     map:clear($ELEMENT_ATTRIBUTE_VALUES),     
     map:clear($ATTRIBUTE_FREQUENCY),          
     map:clear($ATTRIBUTE_VALUES),             
     map:clear($VALUE_QNAME),
     map:clear($NAMESPACE_PREFIX),
     map:clear($NAMESPACE_VALUES),
     map:clear($ELEMENT_NODE_KIND)
   ) 
   let $_ := for $n in $node return (a:document-stat($n),a:analyze($n))
   let $stats-map := map:map()
   let $_ :=
     (
        map:put($stats-map,"ec",0),
        map:put($stats-map,"eac",0),
        map:put($stats-map,"pcc",0)
     )
   let $namespaces :=
     for $ns in map:keys($NAMESPACE_VALUES)
     return
        <namespace>
          <prefix>{
          if(map:get($NAMESPACE_PREFIX,$ns)) 
          then map:get($NAMESPACE_PREFIX,$ns)
          else ""
          }</prefix>
          <namespace-uri>{$ns}</namespace-uri>
        </namespace>    
   (:Element Statistics:)  
   let $elements := 
      for $k in map:keys($ELEMENT_FREQUENCY)
      let $e := map:get($ELEMENT_FREQUENCY,$k)
      let $values-map := map:map()
      let $element-values := map:get($ELEMENT_VALUES,$k)
      let $_ :=
        if(map:get($ELEMENT_CHILD_FREQUENCY,$k)) 
        then map:put($values-map,"#COMPLEX",1)
        else 
           for $ev in $element-values
           return map:put($values-map,$ev,(map:get($values-map,$ev),0)[1] + 1)
      let $namespace := fn:tokenize($k,$ELEMENT_NS_JOINER)[1]
      let $name      := fn:tokenize($k,$ELEMENT_NS_JOINER)[2]
      let $infered-type := a:infer-types(map:keys($values-map))
      let $casted-values := 
        if($infered-type = $NUMERIC_TYPES) then 
        for $v in $element-values[fn:not(. = ($COMPLEX_VALUE,$MIXED_VALUE,$EMPTY_VALUE))] 
        return xdmp:value(fn:concat("$v cast as ",$infered-type)) 
        else ()
      let $string-lengths := for $s in map:keys($values-map) return fn:string-length($s)
      let $xpaths-map := map:map()
      let $_ := for $xp in map:get($ELEMENT_XPATHS,$k) return map:put($xpaths-map,$xp, (map:get($xpaths-map,$xp),0)[1] + 1)
      order by $k
      return 
        <element>{
         element key {xdmp:md5($k)},
         element namespace{$namespace},
         element localname{$name},
         element frequency{$e},
         element distinct-values {map:count($values-map)},
         element infered-types{$infered-type},
         element node-kind{(map:get($ELEMENT_NODE_KIND,$k),"")[1]},
         element min-length{fn:min($string-lengths)},
         element max-length{fn:min($string-lengths)},
         element average-length {fn:ceiling(fn:avg($string-lengths))},
         element min-value{if($infered-type = $NUMERIC_TYPES) then fn:min($casted-values) else ()},
         element max-value{if($infered-type = $NUMERIC_TYPES) then fn:max($casted-values) else ()},
         element avg-value{if($infered-type = $NUMERIC_TYPES) then fn:ceiling(fn:avg($casted-values ! xs:double(.))) else ()},
         element mean-value{if($infered-type = $NUMERIC_TYPES and fn:count($casted-values) ne 0) then (fn:sum($casted-values ! xs:double(.)) div fn:count($casted-values)) else ()},
         <values>{
            for $v in map:keys($values-map) 
            return 
                <value>
                   <node-key>{xdmp:md5($k)}</node-key>
                   <infered-type>{$infered-type}</infered-type>
                   <key>{$v}</key>
                   <frequency>{map:get($values-map,fn:string($v))}</frequency>
                </value>
            }</values>,
            <xpaths>
            {for $xp in map:keys($xpaths-map)
             return 
                <xpath>
                     <xpath-uri>{$xp}</xpath-uri>
                     <xpath-frequency>{map:get($xpaths-map,$xp)}</xpath-frequency>
                </xpath>
            }
            </xpaths>
        }</element>
   (:Element Child Stats:)
   let $element-childs := 
     for $k in map:keys($ELEMENT_CHILD_FREQUENCY)
     let $keys  := fn:tokenize($k,$ELEMENT_CHILD_JOINER)
     let $pkey := $keys[1] 
     let $ckey := $keys[2]
     let $frequency := map:get($ELEMENT_CHILD_FREQUENCY,$k)
     let $child-values-map := map:map()
     let $_ := 
        for $ecv in map:get($ELEMENT_CHILD_VALUES,fn:string($k))
        return
            map:put($child-values-map,fn:string($ecv),(map:get($child-values-map,fn:string($ecv)),0)[1] + 1)
     let $infered-type := a:infer-types(map:keys($child-values-map))
     let $distance := map:get($ELEMENT_CHILD_DISTANCE,$k)
     let $min-distance := fn:min($distance)
     let $max-distance := fn:max($distance)
     let $avg-distance := fn:ceiling(fn:avg($distance))
     let $string-lengths := for $s in map:keys($child-values-map) return fn:string-length($s)
     let $casted-values := 
        if($infered-type = $NUMERIC_TYPES) then 
        for $x in map:get($ELEMENT_CHILD_VALUES,fn:string($k)) [fn:not(. = $MIXED_VALUE)]
        return xdmp:value(fn:concat("$x cast as ",$infered-type))
        else map:get($ELEMENT_CHILD_VALUES,fn:string($k))
    let $parent := 
        let $p := fn:tokenize($pkey,$ELEMENT_NS_JOINER)
        return 
           <parent-element>
            <parent-key>{xdmp:md5(fn:string($pkey))}</parent-key>
            <parent-name>{$p[2]}</parent-name>
            <parent-namespace>{$p[1]}</parent-namespace>
           </parent-element>
     let $child  := 
        let $c := fn:tokenize($ckey,$ELEMENT_NS_JOINER) 
        return
         <child-element>
            <child-key>{xdmp:md5($ckey)}</child-key>
            <child-name>{$c[2]}</child-name>
            <child-namespace>{$c[1]}</child-namespace>         
         </child-element>
     let $xpaths-map := map:map()
     let $_ := 
        for $xp in map:get($ELEMENT_CHILD_XPATHS,$k) 
        return map:put($xpaths-map,$xp, (map:get($xpaths-map,$xp),0)[1] + 1)
     order by $parent/self::pens,$parent/self::pen,$min-distance
     return
        <element-element>{
         element parent-key {fn:data($parent/parent-key)},
         element child-key {fn:data($child/child-key)},
         element key {fn:concat($parent/parent-key,"-", $child/child-key)},
         element parent-namespace {fn:data($parent/parent-namespace)},
         element parent-localname {fn:data($parent/parent-name)},
         element child-namespace {fn:data($child/child-namespace)},
         element child-localname {fn:data($child/child-name)},
         element frequency {$frequency,map:put($stats-map,"pcc",map:get($stats-map,"pcc") + $frequency)},
         element distinct-values {map:count($child-values-map)},
         element infered-types {$infered-type},
         element min-length {fn:min($string-lengths)},
         element max-length {fn:max($string-lengths)},
         element average-length {fn:ceiling(fn:avg($string-lengths))},
         element min-value{if($infered-type = $NUMERIC_TYPES) then fn:min($casted-values) else ()},
         element max-value{if($infered-type = $NUMERIC_TYPES) then fn:max($casted-values) else ()},
         element avg-value{if($infered-type = $NUMERIC_TYPES) then fn:avg($casted-values ! xs:double(.)) else ()},
         element mean-value{if($infered-type = $NUMERIC_TYPES and fn:count($casted-values) ne 0) then (fn:sum($casted-values ! xs:double(.)) div fn:count($casted-values)) else ()},
         element min-distance{$min-distance},
         element max-distance{$max-distance},
         element avg-distance{$avg-distance},
         <values>{
          for $v in map:keys($child-values-map) 
          return 
              <value>
                  <node-key>{xdmp:md5(fn:string($k))}</node-key>
                  <infered-type>{$infered-type}</infered-type>
                  <key>{$v}</key>
                  <frequency>{map:get($child-values-map,fn:string($v))}</frequency>
              </value>
        }</values>,
        <xpaths>{
            for $xp in map:keys($xpaths-map)
            return 
                <xpath>
                     <xpath-uri>{$xp}</xpath-uri>
                     <xpath-frequency>{map:get($xpaths-map,$xp)}</xpath-frequency>
                </xpath>
        }</xpaths>
    }</element-element>
   (:Calculate Element Attribute Statistics:)
   let $element-attributes :=
      for $k in map:keys($ELEMENT_ATTRIBUTE_FREQUENCY)
      let $tokens := fn:tokenize($k,$ATTRIBUTE_JOINER)
      let $attribute-values-map := map:map()
      let $_ := 
          for $av in map:get($ELEMENT_ATTRIBUTE_VALUES,fn:string($k))
          return    
              map:put($attribute-values-map,fn:string($av),(map:get($attribute-values-map,fn:string($av)),0)[1] + 1)
      let $elem :=
          let $t := $tokens[1]
          return
          <attribute-element>
            <element-key>{xdmp:md5($t)}</element-key>
            <element-name>{fn:tokenize($t,$ELEMENT_NS_JOINER)[2]}</element-name>
            <element-namespace>{fn:tokenize($t,$ELEMENT_NS_JOINER)[1]}</element-namespace>
          </attribute-element>
      let $attribute := 
            let $t := $tokens[2]
            let $node-key := xdmp:md5($t)
            let $infered-type := a:infer-types(map:keys($attribute-values-map))
            let $attribute-values := map:keys($attribute-values-map)
            let $casted-values := 
                if($infered-type = $NUMERIC_TYPES) then 
                for $v in $attribute-values[fn:not(. = ($MIXED_VALUE,$COMPLEX_VALUE,$EMPTY_VALUE))] return xdmp:value(fn:concat("$v cast as ",$infered-type))
                else ()
            let $string-lengths := for $s in $attribute-values return fn:string-length($s)
            let $xpaths-map := map:map()
            let $_ := 
               for $xp in map:get($ELEMENT_ATTRIBUTE_XPATHS,$k) 
               return map:put($xpaths-map,$xp, (map:get($xpaths-map,$xp),0)[1] + 1)
            return
              <ea>
                <attribute-key>{xdmp:md5($t)}</attribute-key>
                <attribute-name>{fn:tokenize($t,$ELEMENT_NS_JOINER)[2]}</attribute-name>
                <attribute-namespace>{fn:tokenize($t,$ELEMENT_NS_JOINER)[1]}</attribute-namespace>
                <distinct-values>{map:count($attribute-values-map)}</distinct-values>
                <frequency>{map:get($ELEMENT_ATTRIBUTE_FREQUENCY,$k)}</frequency>
                <infered-types>{$infered-type}</infered-types>
                <min-length>{fn:min($string-lengths)}</min-length>
                <max-length>{fn:max($string-lengths)}</max-length>
                <average-length>{fn:ceiling(fn:avg($string-lengths))}</average-length>
                <min-value>{if($infered-type = $NUMERIC_TYPES) then fn:min($casted-values) else ()}</min-value>
                <max-value>{if($infered-type = $NUMERIC_TYPES) then fn:max($casted-values) else ()}</max-value>
                <avg-value>{if($infered-type = $NUMERIC_TYPES) then fn:floor(fn:avg($casted-values ! xs:double(.))) else ()}</avg-value>
                <median-value>{if($infered-type = $NUMERIC_TYPES and fn:count($casted-values) ne 0) then (fn:sum($casted-values ! xs:double(.)) div fn:count($casted-values)) else ()}</median-value>
                <values>{
                    for $av in map:keys($attribute-values-map)
                    return
                    <value>
                     <node-key>{$node-key}</node-key>
                     <infered-types>{$infered-type}</infered-types>
                     <key>{$av}</key>
                     <frequency>{map:get($attribute-values-map,$av)}</frequency>
                    </value>
                }</values>
                <xpaths>{
                  for $xp in map:keys($xpaths-map)
                  return 
                        <xpath>
                             <xpath-uri>{$xp}</xpath-uri>
                             <xpath-frequency>{map:get($xpaths-map,$xp)}</xpath-frequency>
                        </xpath>
                }</xpaths>
              </ea>
      return
         <element-attribute> {
            element key {
              fn:concat(
                 fn:string($elem/element-key),"-",
                 fn:string($attribute/attribute-key)
         )},
         element element-key {fn:data($elem/element-key)},
         element attribute-key{fn:data($attribute/attribute-key)},
         element namespace {fn:data($elem/element-namespace)},
         element localname {fn:data($elem/element-name)} ,
         element attribute-namespace  {fn:data($attribute/attribute-namespace)},        
         element attribute-localname {fn:data($attribute/attribute-name)},
         element frequency {fn:data($attribute/frequency)},
         element distinct-values {fn:data($attribute/distinct-values)},
         $attribute/infered-types,
         $attribute/min-length,
         $attribute/max-length,
         $attribute/average-length,
         $attribute/min-value,
         $attribute/max-value,
         $attribute/avg-value,
         $attribute/median-value,
         $attribute/values,
         $attribute/xpaths
         }</element-attribute>
   let $attribute-values := 
      for $k in map:keys($ATTRIBUTE_FREQUENCY)
      let $distinct-values-map := map:map()
      let $_ := 
        for $dv in map:get($ATTRIBUTE_VALUES,$k)
        return
           map:put($distinct-values-map,fn:string($dv),((map:get($distinct-values-map,fn:string($dv)),0)[1] + 1))
      let $infered-type := a:infer-types(map:keys($distinct-values-map))
      let $casted-values := 
          if($infered-type = $NUMERIC_TYPES) then 
          for $x in map:get($ATTRIBUTE_VALUES,fn:string($k))
          return xdmp:value(fn:concat("$x cast as ",$infered-type))
          else map:get($ATTRIBUTE_VALUES,fn:string($k))
      let $string-lengths := for $s in map:keys($distinct-values-map) return fn:string-length($s)
      let $xpaths-map := map:map()
      let $_ := 
          for $xp in map:get($ATTRIBUTE_XPATHS,$k) 
          return map:put($xpaths-map,$xp, (map:get($xpaths-map,$xp),0)[1] + 1)
      return
         <attribute>{
           element key {xdmp:md5(fn:string($k))},
           element namespace {fn:tokenize(fn:tokenize($k,$ELEMENT_NS_JOINER)[1],$ATTRIBUTE_JOINER)[2]},
           element localname{fn:tokenize($k,$ELEMENT_NS_JOINER)[2]},
           element frequency{map:get($ATTRIBUTE_FREQUENCY,$k)},
           element distinct-values{map:count($distinct-values-map)},
           element infered-types {a:infer-types(map:keys($distinct-values-map))},
           element min-length {fn:min($string-lengths)},
           element max-length {fn:max($string-lengths)},
           element average-length {fn:ceiling(fn:avg($string-lengths))},
           element min-value{if($infered-type = $NUMERIC_TYPES) then fn:min($casted-values) else ()},
           element max-value{if($infered-type = $NUMERIC_TYPES) then fn:max($casted-values) else ()},
           element avg-value{if($infered-type = $NUMERIC_TYPES) then fn:ceiling(fn:avg($casted-values ! xs:double(.))) else ()},
           element median-value{if($infered-type = $NUMERIC_TYPES and fn:count($casted-values) ne 0) then (fn:sum($casted-values ! xs:double(.)) div fn:count($casted-values)) else ()},         
           <values>{
            for $k in map:keys($distinct-values-map) 
            return 
                <value>
                    <node-key>{xdmp:md5(fn:string($k))}</node-key>
                    <key>{$k}</key>
                    <infered-type>{$infered-type}</infered-type>
                    <frequency>{map:get($distinct-values-map,$k)}</frequency>
               </value>
            }</values>,
            <xpaths>{for $xp in map:keys($xpaths-map)
             return 
                <xpath>
                     <xpath-uri>{$xp}</xpath-uri>
                     <xpath-frequency>{map:get($xpaths-map,$xp)}</xpath-frequency>
                </xpath>
            }
            </xpaths>
         }</attribute>
   (:Now Calculate document sizes:)
   let $document-length := 
        for $k in map:keys($DOCUMENT_SIZE) 
        let $value := map:get($DOCUMENT_SIZE,$k)
        order by $value ascending
        return $value
   let $doc-count := fn:count($document-length)
   let $doc-min := fn:subsequence($document-length,1,1)
   let $doc-max := fn:subsequence($document-length,$doc-count,1)
   let $doc-mean := 
    if($doc-count gt 0 and $document-length gt 0 ) 
    then fn:round-half-to-even((fn:sum($document-length) div $doc-count),1)
    else 0
   let $doc-avg  := fn:avg($document-length)
   let $doc-median := 
      if($doc-count mod 2 eq 0) 
      then fn:subsequence($document-length,fn:floor($doc-count div 2),1)
      else xs:integer(fn:sum(fn:subsequence($document-length,($doc-count div 2),($doc-count div 2) + 1)) div 2)
   let $documents :=  
       for $k in map:keys($DOCUMENT_SIZE)   
       return 
         <document>
           <uri>{$k}</uri>
           <document-size>{map:get($DOCUMENT_SIZE,$k)}</document-size>
         </document>
          
   return
   <analysis>
       <document-statistics>   
            <avg-document-size>{$doc-avg}</avg-document-size>
            <min-document-size>{$doc-min}</min-document-size>
            <max-document-size>{$doc-max}</max-document-size>
            <mean-document-size>{$doc-mean}</mean-document-size>
            <median-document-size>{$doc-median}</median-document-size>
        </document-statistics>
        <namespaces>{$namespaces}</namespaces>
        <elements>{$elements}</elements>
        <element-elements>{$element-childs}</element-elements>
        <element-attributes>{$element-attributes}</element-attributes>
        <attributes>{$attribute-values}</attributes>
        <documents>{$documents}</documents>
   </analysis>
};

declare function a:analyze-root(
    $id as xs:string,
    $root as element(root-element),
    $sample as xs:integer
) {    
    let $root-qname := 
        fn:QName(fn:normalize-space($root/namespace),$root/localname)
    let $query := 
        if(fn:exists($_constraint)) 
        then xdmp:with-namespaces($NS-LIST,xdmp:value($_constraint))
        else cts:and-query(())
    let $version := fn:tokenize(xdmp:version(),"\.|\-")[1] cast as xs:integer
    let $options := 
       if($version ge 5) 
       then xdmp:describe(("score-random"),(),())
       else "()"      
    let $stmt :=
        if(fn:string($root/type) eq "json") then
            fn:concat(
                "cts:search(fn:doc(), ",
                "cts:json-property-scope-query('",
                  $root/localname,"',",
                  xdmp:describe($query,(),()),
                "), ",
                $options,
                ")[1 to " || $_sample|| " ]"
            )
        else if(fn:string($root/namespace) eq "") then
            fn:concat(
                "cts:search(/",
                $root/localname,",",
                xdmp:describe($query,(),()),
                ",",
                $options,
                ")[1 to " || $_sample|| " ]"
            )
        else
           fn:concat(
                "(:ns:)declare namespace _ns0 = '",fn:string($root/namespace),"';&#xA;",
                "cts:search(/_ns0:",
                fn:string($root/localname),", ",
                $query, ", ",
                $options,
                ")[1 to " || $_sample|| " ]"
           )
    let $_ := xdmp:log(fn:concat("Executing query: ", $stmt), "info")   
    let $docs := xdmp:eval($stmt)
    let $docs := $docs[1 to $_sample]
    let $sampled := fn:count($docs)
    let $analyze := a:analyze-documents($docs,$root)
    return
    <content-analysis>
         <analysis-id>{$id}</analysis-id>
         <create-user>{xdmp:get-current-user()}</create-user>
         <created>{fn:current-dateTime()}</created>
         <name>{$_name}</name>
         <database>{$_database}</database>
         <sampled>{$sampled}</sampled>
         <execution-time>{xdmp:elapsed-time()}</execution-time>   
         <query>{$query}</query> 
         <xquery>{$stmt}</xquery>         
         {$root,$analyze/*}
    </content-analysis>
};
let $id := xdmp:md5(fn:string(xdmp:random()))
let $analysis := a:analyze-root($id,$_root-element,$_sample)
let $root-document := 
    element root-element {
       element analysis-id{$id},
       $_root-element/*
    }
let $key := xdmp:md5(fn:concat($_root-element/namespace,$_root-element/localname))
let $uri := fn:concat("/analysis/",$_database,"/",$key,"/", $id,".xml")
let $root-uri := fn:concat("/root-elements/",$_database,"/",fn:data($root-document/id),".xml")
return 
(
    xdmp:eval('
      import module namespace notification = "http://marklogic.com/content-analyzer/notification" at "/lib/notifications-lib.xqy";
      declare variable $document external;
      declare variable $root-document external;
      declare variable $uri as xs:string external;
      declare variable $root-uri as xs:string external;
      declare variable $ticket external;
      (
         xdmp:document-insert($uri,$document,xdmp:default-permissions(),("analysis")),
         xdmp:document-insert($root-uri,$root-document,xdmp:default-permissions(),("root-element")),
         xdmp:node-delete( /*:ticket[*:id eq $ticket]),
         notification:add-notification(
            "Analysis Complete",
            fn:concat("Finished element(", fn:data($document//*:root-element/*:localname), ") for ", $root-document/*:database, " database"),
            "Completed"
         )
      )
    ',
     (fn:QName("","document"),$analysis,
      fn:QName("","root-document"),$root-document,
      fn:QName("","root-uri"),$root-uri,
      fn:QName("","uri"),$uri,
      fn:QName("","ticket"),$_ticket    
     ),
     <options xmlns="xdmp:eval">
      <database>{xdmp:database($_callback-db)}</database>
     </options>
    )
    ,$analysis,
    xdmp:log(
      fn:concat("Analysis Complete for element(", $_root-element/localname, ") in ", $_database, " database with id: ", $id),
      "info")
)