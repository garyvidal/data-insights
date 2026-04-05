xquery version "1.0-ml";
(:~
 : Given a set of document uris will recursively descend each document and create document statistics.
 : The task supports passing in previous analysis to be merged with current analysis.  
 :)
declare default function namespace "urn:local";

declare default element namespace "http://marklogic.com/content-analyzer";  

declare namespace as = "http://www.w3.org/2009/xpath-functions/analyze-string";
declare namespace a = "urn:test";

declare option xdmp:mapping "false";

(:~
 : Defines which keys from maps will be merged back into the result set.
~:)

(:~
 : Is the list of uris for which the analysis will execute against.
~:)
declare variable $_URIS as map:map  external := map:map();

(:~
 : Any Existing analysis data to be merged with the results
~:)
declare variable $_MERGEDATA as map:map external := map:map(fn:doc("/analysis-test.map")/map:map); (:Is existing map of maps data that will be used from a previously analysis:)
(:~
 : Defines the keys of the map that will be marged back to the variables

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
 : Unwraps any existing map:map data passed in from caller
~:)
declare function a:unwrap-mergedata() {
    for $dk in $DATA-KEYS
    let $key-join := "$" || $dk
    let $expr := 
     fn:concat(
       "xdmp:set(",
       $key-join,
       ",if(map:get($_MERGEDATA,$dk) instance of map:map) then ",
       $key-join,
       " + map:get($_MERGEDATA,$dk) else map:map())")
    return 
      xdmp:value($expr)
};

(:~
 : Returns a node key similar to xdmp:key-from-QName
 :)
declare function a:QName-from-node-key($key) as xs:QName{
  let $pattern := "\{(.*)\}(\i\c*)"
  return
    if(fn:matches($key, $pattern))
    then 
       let $tokenz := fn:analyze-string($key,$pattern)
       return
         fn:QName($tokenz//as:group[@nr=1],$tokenz//*:group[@nr= 2])
    else fn:QName("",$key)
    
};
(:~
 : Builds a navigation tree structure
~:)
declare function a:path-navigator($paths,$parent,$analysis){
  let $parents := fn:distinct-values( $paths[. ne ""] ! fn:tokenize(.,"/")[1])
  for $p in $parents
  let $localname := 
    if(fn:contains($p,":")) then fn:substring-after($p,":") else $p
  let $parent-localname := 
    if(fn:contains($parent,":")) then fn:substring-after($parent,":") else $parent
  let $node := 
      if(fn:not($parent))
      then ()
      else if(fn:starts-with($p,"@")) 
      then $analysis//element-attribute[localname = $parent-localname and attribute-localname = fn:substring-after($p,"@")]
      else $analysis//element-element[parent-localname = $parent-localname and child-localname = $localname]
  let $pos := 
      if(fn:not($node)) then 1 
      else if(fn:starts-with($p,"@")) then 0
      else xs:integer(($node/min-distance)[1])
  let $children := 
      for $path in $paths
      let $parts := fn:tokenize($path,"/")
      where $parts[1] = $p and fn:count($parts) gt 1
      return $path
  let $child-paths := ($children ! fn:string-join(fn:tokenize(.,"/")[2 to fn:last()],"/"))[fn:normalize-space(.) ne ""]
  order by $pos,$p
  return
      if($p = "") then 
         <navigator>
         {a:path-navigator($child-paths,$p,$analysis)}
         </navigator>
      else if(fn:starts-with($p,"@")) then
        <attribute name="{fn:substring-after($p,"@")}" key="{$node/key}" />
      else 
        <element name="{$p}" pos="{$node/min-distance}" key="{$node/key}">{
          if($children) then a:path-navigator($child-paths,$p,$analysis) 
          else ()
        }</element>
};
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
  a:unwrap-mergedata(),
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
      let $elem-qname := a:QName-from-node-key($k)
      let $namespace := fn:namespace-uri-from-QName($elem-qname) (:fn:tokenize($k,$ELEMENT_NS_JOINER)[1]:)
      let $name      := fn:local-name-from-QName($elem-qname)(:fn:tokenize($k,$ELEMENT_NS_JOINER)[2]:)
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
         element min-length{fn:min($string-lengths)},
         element max-length{fn:min($string-lengths)},
         element average-length {fn:ceiling(fn:avg($string-lengths))},
         element min-value{if($infered-type = $NUMERIC_TYPES) then fn:min($casted-values) else ()},
         element max-value{if($infered-type = $NUMERIC_TYPES) then fn:max($casted-values) else ()},
         element avg-value{if($infered-type = $NUMERIC_TYPES) then fn:ceiling(fn:avg($casted-values)) else ()},
         element mean-value{if($infered-type = $NUMERIC_TYPES and fn:count($casted-values) ne 0) then (fn:sum($casted-values) div fn:count($casted-values)) else ()},
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
     let $pkey := ($keys[1][. ne ""],"document")[1] 
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
        let $p := a:QName-from-node-key($pkey)
        return 
           <parent-element>
            <parent-key>{xdmp:md5(fn:string($pkey))}</parent-key>
            <parent-name>{fn:local-name-from-QName($p)}</parent-name>
            <parent-namespace>{fn:namespace-uri-from-QName($p)}</parent-namespace>
           </parent-element>
     let $child  := 
        let $c :=a:QName-from-node-key($ckey)
        return
         <child-element>
            <child-key>{xdmp:md5($ckey)}</child-key>
            <child-name>{fn:local-name-from-QName($c)}</child-name>
            <child-namespace>{fn:namespace-uri-from-QName($c)}</child-namespace>         
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
         element avg-value{if($infered-type = $NUMERIC_TYPES) then fn:avg($casted-values) else ()},
         element mean-value{if($infered-type = $NUMERIC_TYPES and fn:count($casted-values) ne 0) then (fn:sum($casted-values) div fn:count($casted-values)) else ()},
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
          let $t := a:QName-from-node-key($tokens[1])
          let $th := xdmp:md5($tokens[1])
          return
          <attribute-element>
            <element-key>{$th}</element-key>
            <element-name>{fn:local-name-from-QName($t)}</element-name>
            <element-namespace>{fn:namespace-uri-from-QName($t)}</element-namespace>
          </attribute-element>
      let $attribute := 
            let $t := a:QName-from-node-key($tokens[2])
            let $th := xdmp:md5($tokens[2])
            let $node-key := $tokens[2]
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
                <attribute-key>{$th}</attribute-key>
                <attribute-name>{fn:local-name-from-QName($t)}</attribute-name>
                <attribute-namespace>{fn:namespace-uri-from-QName($t)}</attribute-namespace>
                <distinct-values>{map:count($attribute-values-map)}</distinct-values>
                <frequency>{map:get($ELEMENT_ATTRIBUTE_FREQUENCY,$k)}</frequency>
                <infered-types>{$infered-type}</infered-types>
                <min-length>{fn:min($string-lengths)}</min-length>
                <max-length>{fn:max($string-lengths)}</max-length>
                <average-length>{fn:ceiling(fn:avg($string-lengths))}</average-length>
                <min-value>{if($infered-type = $NUMERIC_TYPES) then fn:min($casted-values) else ()}</min-value>
                <max-value>{if($infered-type = $NUMERIC_TYPES) then fn:max($casted-values) else ()}</max-value>
                <avg-value>{if($infered-type = $NUMERIC_TYPES) then fn:floor(fn:avg($casted-values)) else ()}</avg-value>
                <median-value>{if($infered-type = $NUMERIC_TYPES and fn:count($casted-values) ne 0) then (fn:sum($casted-values) div fn:count($casted-values)) else ()}</median-value>
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
           element avg-value{if($infered-type = $NUMERIC_TYPES) then fn:ceiling(fn:avg($casted-values)) else ()},
           element median-value{if($infered-type = $NUMERIC_TYPES and fn:count($casted-values) ne 0) then (fn:sum($casted-values) div fn:count($casted-values)) else ()},         
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
    if($doc-count > 0 and $document-length < 0 ) 
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
   let $analysis := 
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
   let $xpaths := for $uri in fn:distinct-values($analysis//xpath-uri) order by $uri return $uri
   let $navigator := a:path-navigator($xpaths,(),$analysis)
   return
      <analysis>
      {$analysis/*,
       $navigator 
      }
      </analysis>
