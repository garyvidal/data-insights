xquery version "1.0-ml";

declare variable $TASK-INPUT as map:map external;
declare variable $TASK-OUTPUT as map:map external;
declare variable $TASK-PROPERTIES as map:map external;
let $output :=  map:map()
let $process := 
    for $key in map:keys($TASK-INPUT)
    let $doc := fn:doc($key)/node()
    let $nodeType := 
       if($doc instance of binary()) 
       then "binary"
       else if($doc instance of element()) 
            then "element"
       else "text"
    let $nodeKey := 
        if($nodeType eq "binary") 
        then "binary"
        else if($nodeType eq "element") 
        then fn:concat("{",fn:namespace-uri($doc),"}",fn:local-name($doc))
        else "text"        
    return 
       map:put($TASK-OUTPUT,$nodeKey,(map:get($TASK-OUTPUT,$nodeKey),0)[1] + 1)   
return 
    ($TASK-OUTPUT,xdmp:log(fn:concat("TASK OUTPUT:",map:count($TASK-OUTPUT))))