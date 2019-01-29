module.exports = function(app) {
	var async = app.locals.async;
	var config = app.locals.config;
	var http = app.locals.http;
	var mysqlLib = app.locals.mysqlLib;
	var mysqlPool = app.locals.mysqlPool;

	// get all bus stops from server and save
	app.get('/busservices/populate', function(req, res) {
		var conn = null;

		async.auto({
			getConn: function(callback) {
				mysqlPool.getConnection(function(err, connection) {
					conn = connection;
					callback(err);
				});
			},
			getBusStops: ['getConn', function(results, callback) {
				var currentSkip = 0; // increment by 50
				var incrementValue = 50;

				async.doWhilst(
					function(whilstCallback) {

						res.write('retrieving ' + currentSkip + '; ');

						var options = {
							host: 'datamall2.mytransport.sg',
							port: 80,
							path: '/ltaodataservice/BusServices?$skip=' + currentSkip,
							headers: {
								'AccountKey': config.datamall.AccountKey,
								'UniqueUserID': config.datamall.UniqueUserID,
								'accept': 'application/json'
							}
						};

						var data = '';
						http.get(options, function(httpRes) {
							httpRes.on("data", function(chunk) {
								data += chunk;
							});
							httpRes.on('end', function() {
								var json = JSON.parse(data);
								var busServiceCount = json["value"].length;

								// still has more bus stops to go?
								if (busServiceCount == incrementValue) {
		    						currentSkip += incrementValue;
		    					} else {
		    						currentSkip = -1;
		    					}

		    					// we have any data to insert?
		    					if (busServiceCount > 0) {
									var sqlQuery = 'INSERT INTO bus_services (service_no, operator, direction, category, origin_code, destination_code, am_peak_freq, am_offpeak_freq, pm_peak_freq, pm_offpeak_freq, loop_desc) VALUES ';
									for (var i=0; i<busServiceCount; i++) {
										var busService = json["value"][i];
										var subquery = mysqlLib.format('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
											[busService['ServiceNo'], busService['Operator'], busService['Direction'], busService['Category'], busService['OriginCode'], busService['DestinationCode'],
											busService['AM_Peak_Freq'], busService['AM_Offpeak_Freq'], busService['PM_Peak_Freq'], busService['PM_Offpeak_Freq'], busService['LoopDesc']]);

										sqlQuery += subquery;

										if (i + 1 < busServiceCount) {
											sqlQuery += ',';
										} else {
											sqlQuery += 'ON DUPLICATE KEY UPDATE operator=VALUES(operator), direction=VALUES(direction), category=VALUES(direction), origin_code=VALUES(origin_code), destination_code=VALUES(destination_code), '
												+ 'am_peak_freq=VALUES(am_peak_freq), am_offpeak_freq=VALUES(am_offpeak_freq), pm_peak_freq=VALUES(pm_peak_freq), pm_offpeak_freq=VALUES(pm_offpeak_freq), loop_desc=VALUES(loop_desc);';
										}
									}

			    					// save to db
			    					conn.query(sqlQuery, function(err) {	
			    						if (err == null) {
			    							res.write('insert done');
			    							whilstCallback(err);
										} else { // if there's an error, straightaway jump to end
			    							callback(err);
			    						}
				    				});
			    				} else {
			    					whilstCallback(null);
			    				}
		    				});
						}).on('error', function(e) {
							whilstCallback(e, null);
						});
					},
					function() {
						res.write("\n");

						if (currentSkip > -1) {
							return true;
						} else {
							return false;
						}
					},
					function(err) {
						callback(err);
					}
				);
			}],
		}, function(err, results) {
			if (conn) {
				conn.release();
			}

			if (err != null) {
				res.end('error: ' + err);
			} else {
				res.end("done");
			}
		});
	});
};