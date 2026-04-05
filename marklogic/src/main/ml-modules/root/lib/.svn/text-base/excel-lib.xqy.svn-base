xquery version '1.0-ml';

module namespace excel = "http://marklogic.com/excel";

declare namespace zip   = "xdmp:zip";
declare namespace ss = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

import module namespace ooxml="http://marklogic.com/openxml" at "/MarkLogic/openxml/package.xqy";
import module namespace ml-excel="http://marklogic.com/openxml/excel" at "spreadsheet-ml-support2.xqy";

declare option xdmp:mapping "false";

(::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
  :: GENERIC EXCEL FUNCTIONS
 ::)

declare function excel:get-parts($excel as node(), $part-uris as xs:string*) as node()* {
	let $parts :=
		ooxml:package-parts($excel)
	for $uri at $pos in ooxml:package-uris($excel)
	where $uri = $part-uris
	return
		$parts[$pos]
};

declare function excel:row-is-empty($row as element(ss:row)) as xs:boolean {
    every $c in $row/ss:c
    satisfies fn:normalize-space(fn:string($c/ss:v)) eq ""
    and fn:not($c/ss:v)
};

declare function excel:get-number($string as xs:string){
    if ($string castable as xs:float) then
         xs:float($string) cast as xs:integer
    else ()
};

declare function excel:xlsx-to-map($excel){
    let $excelmap := map:map()
    
	let $parts := ooxml:package-parts($excel)
	let $_ :=
	    for $uri at $pos in ooxml:package-uris($excel)
	    return
              map:put($excelmap,$uri,fn:subsequence($parts,$pos))

     return $excelmap
};

declare function excel:get-sheet-names(
$excel-map as map:map
)
{
   map:get($excel-map,"xl/workbook.xml")
};
declare function excel:get-sheet-by-name(
    $excel-map as map:map, 
    $sheetname as xs:string 
) as element(ss:worksheet)?
{ 
 let $sheet-ref :=
  map:get($excel-map,"/xl/workbook.xml")/ss:workbook/ss:sheets/ss:sheet[@name eq $sheetname]/fn:string(@sheetname)
  return 
    map:get($excel-map, fn:concat("/xl/worksheets/", $sheet-ref))/ss:worksheet
};

declare function excel:replace-parts($excel as node(), $part-uris as xs:string*, $parts as node()*) as node() {
	let $uris :=
		ooxml:package-uris($excel)
	let $new-parts :=
		for $part at $pos in ooxml:package-parts($excel)
		let $uri := $uris[$pos]
		return
			if ($uri = $part-uris) then
				let $index := fn:index-of($part-uris, $uri)
				return
					$parts[$index]
			else
				$part
	let $manifest :=
		<zip:parts>{
			for $uri in $uris
			return
				<zip:part>{$uri}</zip:part>
		}</zip:parts>
    let $add := 
        for $uri at $pos in $part-uris
        return 
          if($uri = $uris) then ()
          else 
            (xdmp:set($new-parts,($new-parts,$parts[$pos])),
             xdmp:set($manifest,
              <zip:parts>{
                $manifest/*,
                <zip:part>{$uri}</zip:part> 
              }</zip:parts>)
           )
	return 
		xdmp:zip-create($manifest, $new-parts)
};
 
declare function excel:get-sheet-uris($excel as node()) as xs:string* {
	for $uri in ooxml:package-uris($excel)
	where fn:contains($uri, 'worksheets/sheet')
	order by $uri
	return
		$uri
};

declare function excel:get-shared-strings-uri($excel as node()) as xs:string? {
	for $uri at $pos in ooxml:package-uris($excel)
	where fn:contains($uri, 'sharedStrings')
	return
		$uri
};

declare function excel:get-sheet-rows($sheet as element(ss:worksheet)) as element(ss:row)* {
	$sheet/ss:sheetData/ss:row
};

declare function excel:replace-sheet-rows($sheet as element(ss:worksheet), $rows as element(ss:row)*) as element(ss:worksheet) {
	let $sheetData := $sheet/ss:sheetData
	return
		<ss:worksheet> {
			$sheet/@*,
			$sheet/node()[. << $sheetData],
			<ss:sheetData> {
				$sheetData/@*,
				$rows
			} </ss:sheetData>,
			$sheet/node()[. >> $sheetData]
		} </ss:worksheet>
};

declare function excel:get-cell-row-index($cell as element(ss:c)) as xs:integer {
	ml-excel:a1-row($cell/@r)
};
declare function excel:get-cell-col-index($cell as element(ss:c)) as xs:integer {
	ml-excel:col-letter-to-idx(ml-excel:a1-column($cell/@r))
};

declare function excel:get-row-cells($row as element(ss:row)?) as element(ss:c)* {
	excel:get-row-cells($row, fn:false())
};

declare function excel:get-row-cells
(
  $row as element(ss:row)?,
  $expand-cells as xs:boolean) as element(ss:c)*
{
  (: no cells if no row :)
  if (fn:not($row))
  then ()

	else if ($expand-cells) then
		(: This works, but adds unformatted cells that may not fit in nicely.
		 : Could use copy-cell, but which best to copy?
		 :)
		for $c at $pos in $row/ss:c
		let $row-index := excel:get-cell-row-index($c)
		let $col-index := excel:get-cell-col-index($c)
		let $prev-col := $row/ss:c[$pos - 1]
		let $prev-col-index :=
			if ($prev-col) then
				ml-excel:col-letter-to-idx(ml-excel:a1-column($prev-col/@r))
			else if ($pos = 1) then
				0
			else
				$col-index
		return (
			for $i in ($prev-col-index + 1) to ($col-index - 1)
			let $r := ml-excel:r1c1-to-a1($row-index, $i)
			return
				ml-excel:cell($r, ()),
			$c
		)
	else
		$row/ss:c
};

(: Improved version of the one in spreadsheet-ml-support.xqy :-/ :)
declare function excel:cell-string-value(
	$cells          as element(ss:c)*,
	$shared-strings as element(ss:sst)?
) as xs:string*
{ 
  for $c at $pos in $cells
  let $value :=
    if ( $c/@t="s" )
    then
      let $shared-string :=
        $shared-strings/ss:si[ fn:data($c/ss:v) + 1 ]/ss:t
      return
        if ($shared-string)
        then
          $shared-string
        else
          (:fn:error(xs:QName("excel:missingstr"), fn:concat("Shared string missing for cell ", $pos)):)
        ()
    else if ($c/@t eq "inlineStr")
    then
      $c/ss:is/ss:t
    else
      $c/ss:v
  return
    (: use fn:string() to account for empty cells, makes sure count
     : of return strings always equals count of input cells
     :)
    fn:string($value)
};

declare function excel:normalize-cell(
	$cells          as element(ss:c)*,
	$shared-strings as element(ss:sst)?
) as element(ss:c)*
{ 
    for $c at $pos in $cells
    let $value :=
        if ( $c/@t="s" ) then
			let $shared-string :=
				$shared-strings/ss:si[ fn:data($c/ss:v) + 1 ]/ss:t
			return
				if ($shared-string) then
					$shared-string
				else
					(:fn:error(xs:QName("excel:missingstr"), fn:concat("Shared string missing for cell ", $pos)):)
					()
        else
			$c//text()
	return
		(: use fn:string() to account for empty cells, makes sure count
		 : of return strings always equals count of input cells
		 :)
		<ss:c t="inlineStr">
		  { $c/@*[fn:local-name(.) ne "t"] }
		  <ss:is>
        <ss:v>{$value}</ss:v>
      </ss:is>
    </ss:c>
};

declare function excel:set-cell-value(
	$cell    as element(ss:c),
	$value   as xs:anyAtomicType?, 
	$formula as xs:string?,
	$date-id as xs:integer?
) as element(ss:c)
{
    if ($value castable as xs:integer or fn:empty($value)) then     
		let $date-attr :=
			if (fn:empty($date-id)) then
				$cell/@s
			else
				attribute s { $date-id }
        let $formula :=
			if(fn:not(fn:empty($formula))) then 
                <ss:f>{$formula}</ss:f> 
            else ()
        let $value :=
			if(fn:not($value eq 0) and fn:not(fn:empty($value)))then
				<ss:v>{$value}</ss:v>
            else ()
        return
			<ss:c>{
				$cell/@* except $cell/(@t|@s),
				$date-attr,
				$formula,
				$value
			}</ss:c>
    else
		<ss:c t="inlineStr"> 
			{ $cell/@* except $cell/@t }
			<ss:is>
				<ss:t>{$value}</ss:t>
			</ss:is>
		</ss:c>
};

declare function excel:copy-cell(
	$cell     as element(ss:c),
	$dest-row as xs:integer,
	$dest-col as xs:integer
) as element(ss:c)
{
	<ss:c r="{ml-excel:r1c1-to-a1($dest-row, $dest-col)}">{
		$cell/@* except $cell/@r,
		$cell/node()
	}</ss:c>
};

(::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
 :: HMH SPECIFIC EXCEL FUNCTIONS
 ::)

declare function excel:get-sheet-column-names($sheet as element(ss:worksheet), $shared-strings as element(ss:sst)?) as xs:string* {
	for $value in
		excel:cell-string-value(
			excel:get-row-cells(
				excel:get-sheet-rows($sheet)[1],
				fn:true()
			),
			$shared-strings
		)
	where fn:string-length($value) > 0
	return
		fn:normalize-space($value)
};

declare function excel:string-to-element-name($string as xs:string) as xs:QName {
	(: remove unwanted chars :)
	xs:QName(fn:replace($string, '[^a-zA-Z0-9\\-\\_]', ''))
};

declare function excel:map-row-cells-to-elements($row as element(ss:row)?, $column-names as xs:string*, $shared-strings as element(ss:sst)?) as element()* {
	for $cell in excel:get-row-cells($row)[1 to fn:count($column-names)]
	let $pos := excel:get-cell-col-index($cell)
	let $row-number := excel:get-cell-row-index($cell)
	let $value :=
	  fn:normalize-space(fn:translate(excel:cell-string-value($cell, $shared-strings), '&#160;', ' '))
	where $value
	return
		element field { 
		  attribute columnName { $column-names[$pos] },
		  attribute row { $row-number },
		  attribute col { $pos },
			$value
		}
};

declare function excel:set-cell-string-value(
	$cell    as element(ss:c),
	$value   as xs:anyAtomicType?, 
	$formula as xs:string?,
	$date-id as xs:integer?
) as element(ss:c)
{
		<ss:c t="inlineStr"> 
			{ $cell/@* except $cell/@t }
			<ss:is>
				<ss:t>{fn:string($value)}</ss:t>
			</ss:is>
		</ss:c>
};