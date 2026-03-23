function populateVendorName(name,id,users)
{
		
	document.forms["vendorForm"].action = "update";
	document.getElementById("name").value= name;
	document.getElementById("name").disabled ="true";
	document.getElementById("vendor-id").value= id;
	document.getElementById("submit").value= "Update Vendor";
	
	var tokens = users.split( ";" );
	
	var elements = document.forms["vendorForm"].elements;
	for(var i=0;i<elements.length; i++)
	{
		e=elements[i];
		if(e.name == "notify")
		{
			e.checked = false;

			var match = "false";				//uncheck any previously checked boxes.
			for(var j=0;j<tokens.length; j++)
			{
				var token = tokens[j].replace(/^\s+|\s+$/g, '');
				if(e.value == token)
				{
					match = "true";
				}
			}
			if(match=="true")
				e.checked = true;
			else
				e.checked = false;
		}
	}


}

function populateUser(id,name,email,type,vendor)
{
	document.getElementById("id1").value= id;
	document.getElementById("id2").value= id;
	document.getElementById("e_username").value= name;
    document.getElementById("e_email").value= email;
    document.getElementById("e_type").value= type;
	setDropDownValue(document.forms["pform"].elements, "e_vendor", vendor);

	document.getElementById('updateuserdiv').style.display = 'block';
	document.getElementById('newuserdiv').style.display = 'none'; 

}

function setDropDownValue(elements, elementId, val)
{
for(var i=0;i<elements.length; i++)
	{
		var e=elements[i];
		
		if(e.id == elementId)
		{
			var length = e.options.length;
			for(var j=0; j<length; j++)
			{
				//alert(e.options[j].value == val);
				if(e.options[j].value == val)
				{
					e.selectedIndex = j;
					break;
				}
			}
			
		}
	}
}
function populateProject(id,name,edition,isbn,author,vendor,schema,status,schematrons,users)
{
	document.getElementById("id").value= id;
	document.getElementById("e_name").value= name;
    document.getElementById("e_edition").value= edition;
    document.getElementById("e_isbn").value= isbn;
    document.getElementById("e_author").value= author;
    setDropDownValue(document.forms["epform"].elements, "e_vendor-id", vendor);
	setDropDownValue(document.forms["epform"].elements, "e_schema-id", schema);
	setDropDownValue(document.forms["epform"].elements, "e_status", status);
//    document.getElementById("e_status").value= status;



	var elements = document.forms["epform"].elements;
	var sch_ids = schematrons.split(";");
	
	//Populate the schematrons
	for(var i=0;i<elements.length; i++)
	{
		e=elements[i];
		if(e.name == "schematron-id")
		{
			var match = "false";
			for(var j=0;j<sch_ids.length; j++)
			{
				if(e.value == sch_ids[j])
					match = "true";
			}
			if(match=="true")
				e.checked = true;
		    else
		    	e.checked = false;
		}
	}
	//Populate the notify/user-id
	var user_ids = users.split(";");
	for(var i=0;i<elements.length; i++)
	{
		e=elements[i];
		if(e.name == "user-id")
		{
			var match = "false";
			for(var j=0;j<user_ids.length; j++)
			{
				if(e.value == user_ids[j])
					match = "true";
			}
			if(match=="true")
				e.checked = true;
			else 
				e.checked = false;
		}
	}
	//Moved to bottom to let form populate
	document.getElementById('editproject').style.display = 'block';
	document.getElementById('newproject').style.display = 'none'; 

}

function populateSchema(id,name,version,prefix, namespace,uri,schematrons)
{
	var tokens = schematrons.split( "," );
	//alert(tokens.length);
	
	document.forms["Add"].action = "/schema/update";
	
	document.getElementById("id").value= id;
	document.getElementById("name").value= name;
    document.getElementById("version").value= version;
    document.getElementById("prefix").value= prefix;
    document.getElementById("namespace").value= namespace;
    document.getElementById("uri").value= uri;
	document.getElementById("submit").value= "Update Schema";
	
	//check the matching check boxes
	var elements = document.forms["Add"].elements;
	for(var i=0;i<elements.length; i++)
	{
		e=elements[i];
		//alert(document.getElementById("schematron-id")[1]);
		if(e.name == "schematron-id")
		{
			var match = "false";
			for(var j=0;j<tokens.length; j++)
			{
				if(e.value == tokens[j])
					match = "true";
			}
			if(match=="true")
				e.checked = true;
			else 
				e.checked = false;
		}

	}
}