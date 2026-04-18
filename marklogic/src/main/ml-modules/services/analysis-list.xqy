xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/analysis-list";

declare namespace ca = "http://marklogic.com/content-analyzer";
declare default element namespace "http://marklogic.com/content-analyzer";

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $db           := map:get($params, "db")
    let $root-element := map:get($params, "root")
    return
        document {
            <analysis-list>{
                for $analysis in
                    cts:search(/ca:content-analysis,
                        cts:and-query((
                            cts:element-value-query(xs:QName("ca:database"), $db),
                            if ($root-element)
                            then cts:element-query(xs:QName("ca:root-element"),
                                    cts:element-value-query(xs:QName("ca:id"), $root-element))
                            else ()
                        ))
                    )
                order by $analysis/root-element/localname ascending,
                         xs:dateTime($analysis/ca:created) descending
                return
                    <analysis>
                        {
                            $analysis/analysis-id,
                            <analysis-uri>{xdmp:node-uri($analysis)}</analysis-uri>,
                            <analysis-name>{fn:data($analysis/name)}</analysis-name>,
                            $analysis/database,
                            $analysis/ca:root-element
                        }
                    </analysis>
            }</analysis-list>
        }
};
