exports.ReturnError = function(res, message) {
	var json = {
		Error: 1,
		Msg: message
	}; 

	res.end(JSON.stringify(json));
};

var BUS_STATUS = {
	'in operation': 1,
	'not in operation': 0
};

var BUS_LOAD = {
	'seats available': 2,
	'standing available': 1,
	'limited standing': 0
};

exports.ConvertBusStatusStrToInt = function(statusStr) {
	if (statusStr != null) {
		statusStr = statusStr.toLowerCase();
		if (statusStr in BUS_STATUS) {
			return BUS_STATUS[statusStr];
		} else {
			return null;
		}
	} else {
		return null;
	}
};

exports.ConvertBusLoadStrToInt = function(loadStr) {
	if (loadStr != null) {
		loadStr = loadStr.toLowerCase();
		if (loadStr in BUS_LOAD) {
			return BUS_LOAD[loadStr];
		} else {
			return null;
		}
	} else {
		return null;
	}
};

exports.GetTimeDiff = function(time1, time2) {
	var diff = (time2 - time1) / 60000;
	if (diff < 0) {
		diff = 0;
	}

	return diff;
};

exports.GetDistance = function(lat1, lon1, lat2, lon2) {
	var R = 6371; // Radius of the earth in km
	var dLat = deg2rad(lat2-lat1);  // deg2rad below
	var dLon = deg2rad(lon2-lon1); 
	var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
			Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
			Math.sin(dLon/2) * Math.sin(dLon/2); 

	var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
	var d = R * c; // Distance in km
	return d;
};

exports.Deg2Rad = function(deg) {
	return deg * 0.017453292519943295; // Math.PI / 180
};