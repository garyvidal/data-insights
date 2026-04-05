xquery version "1.0-ml";

declare namespace ca = "http://marklogic.com/content-analyzer";

declare variable $schema-uri as xs:string external;
declare variable $analysis-id as xs:string external;

(:~Variables~:)
declare variable $schema := fn:doc($schema-uri);
declare variable $analysis := /ca:content-analysis[ca:analysis-id eq $analysis-id];
declare variable $map := map:map();
declare variable $map2 := map:map();
declare variable $map3 := map:map();
declare variable $map4 := map:map();


declare function local:ct ($parent, $type) {
 for $c in $type//xs:element
 return map:put ($map, fn:concat($parent,"/",$c/@ref), 0), 
    for $g in $type//xs:group
    for $c in $schema//xs:group[fn:string(@name) = fn:string($g/@ref)]//xs:element
    return  
         map:put ($map, fn:concat($parent,"/",$c/@ref), 0)

};
(:Initialize The Schema Elements:)
let $_ := 
   for $i in $schema/xs:schema/xs:element 
   return 
   (
    if ($i/@type) then local:ct (($i/@name), $schema//xs:complexType [fn:string(@name) = fn:string($i/@type)]) else (),
       for $c in $i//xs:element
       return  map:put ($map, fn:concat($i/@name,"/",$c/@ref), 0),
   for $g in $i//xs:group
   for $c in $schema//xs:group[fn:string(@name) = fn:string($g/@ref)]//xs:element
     return  map:put ($map, fn:concat($i/@name,"/",$c/@ref), 0)
   ) 

let $_ := 
    for $elem in $analysis/ca:element-elements/ca:element-element
    let $s := $elem/ca:child-localname
    let $el := fn:concat($elem/ca:parent-localname, "/", $elem/ca:child-localname)
    return (
            map:put($map4, $s, $elem/ca:frequency), 
            map:put($map, $el, $elem/ca:frequency)
           )  
let $_ := for $element in map:keys($map) return 
          let $el := fn:substring-before($element,"/")
          return map:put($map2, $el, fn:max((map:get($map2, $el),0)) + 1)
let $_ := for $element in map:keys($map) return 
          let $el := fn:substring-before($element,"/")
          where map:get($map, $element) gt 0
          return map:put($map3, $el, fn:max((map:get($map3, $el),0)) + 1)       
return 
<items type="array">{
for $element  in map:keys($map)
let $v := map:get($map, $element)
let $p :=  fn:substring-before($element,"/")
order by $element 
return
  <item type="object">
    <parent type="string">{$p}</parent>
    <element type="string">{$element}</element>
    <parent-variation>{fn:string( map:get($map2, $p))}</parent-variation>
    <parent-frequency>{fn:string( fn:max((0,map:get($map4, $p))))}</parent-frequency>
    <parentchild-variation>{fn:string( fn:max((0,map:get($map3, $p))))}</parentchild-variation>
    <parentchild-frequency>{fn:string($v)}</parentchild-frequency>
  </item>
}</items>
(:
fn:string-join(( $p, $element, fn:string( map:get($map2, $p)), fn:string( fn:max((0,map:get($map4, $p)))),   fn:string( fn:max((0,map:get($map3, $p)))), fn:string($v)), ",")
:)

