module.exports = function(app) {
	var async = app.locals.async;
	var config = app.locals.config;
	var http = app.locals.http;
	var mysqlLib = app.locals.mysqlLib;
	var mysqlPool = app.locals.mysqlPool;
	var util = app.locals.util;

	

	// get all bus stops from server and save
	app.get('/busarrivals/get/:busstopcode', function(req, res) {
		// return type will be json
		res.setHeader('Content-Type', 'application/json');

		var conn = null;
		var busStopCode = null;

		async.auto({
			validateGetVariable: function(callback) {
				// is this a valid bus stop id?
				if (req.params.busstopcode != null) {
					busStopCode = req.params.busstopcode;
					callback(null);
				} else {
					callback("missing variables");
				}
			},
			getConn: ['validateGetVariable', function(results, callback) {
				mysqlPool.getConnection(function(err, connection) {
					conn = connection;
					if (err) {
						callback(err.code);
					} else {
						callback(null);
					}
				});
			}],
			checkBusStopExists: ['getConn', function(results, callback) { // check whether we have this bus stop or not
				conn.query('SELECT bus_stop_code FROM bus_stops WHERE bus_stop_code=?;', [busStopCode], function(err, dbResult) {
					if (err) {
						callback(err.code);
					} else if (dbResult.length == 0) {
						callback("bus stop not found");
					} else {
						busStopCode = dbResult[0].bus_stop_code; // use the value we got from db
						callback(null);
					}
				});
			}],
			getLocalBusArrivals: ['checkBusStopExists', function(results, callback) {
				var query = 'SELECT bus_stop_code, service_no, status, operator, originating_id, terminating_id, '
						+ '1_estimated_arrival, 1_latitude, 1_longitude, 1_visit_number, 1_load, 1_feature, '
						+ '2_estimated_arrival, 2_latitude, 2_longitude, 2_visit_number, 2_load, 2_feature, '
						+ '3_estimated_arrival, 3_latitude, 3_longitude, 3_visit_number, 3_load, 3_feature, last_updated FROM bus_arrivals WHERE bus_stop_code=?;'

				conn.query(query, [busStopCode], function(err, dbResult) {
					if (err) {
						callback(err.code);
					} else if (dbResult.length == 0) {
						callback(null, null); // no timing, retrive
					} else {
						var now = new Date();

						// allow to update bus timing if more than 50 seconds
						if (now - dbResult[0].last_updated > 50000) {
							callback(null, null);
						} else {
							var now = new Date();

							for (var i=0; i<dbResult.length; i++) {
								if (dbResult[i]['1_load'] != null) {
									dbResult[i]['1_estimated_arrival'] = util.GetTimeDiff(now, new Date(dbResult[i]['1_estimated_arrival']));
								} else {
									dbResult[i]['1_estimated_arrival'] = -1;
								}			

								if (dbResult[i]['2_load'] != null) {
									dbResult[i]['2_estimated_arrival'] = util.GetTimeDiff(now, new Date(dbResult[i]['2_estimated_arrival']));
								} else {
									dbResult[i]['2_estimated_arrival'] = -1;
								}	

								if (dbResult[i]['3_load'] != null) {
									dbResult[i]['3_estimated_arrival'] = util.GetTimeDiff(now, new Date(dbResult[i]['3_estimated_arrival']));
								} else {
									dbResult[i]['3_estimated_arrival'] = -1;
								}	
							}

							callback(null, dbResult);
						}
					}
				});
			}],
			getBusArrivals: ['getLocalBusArrivals', function(results, callback) {
				var localBusArrivals = results.getLocalBusArrivals;

				if (localBusArrivals == null) {
					var options = {
						host: 'datamall2.mytransport.sg',
						port: 80,
						path: '/ltaodataservice/BusArrival?SST=True&BusStopID=' + busStopCode,
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
							var serviceCount = json['Services'].length;

							var sqlQuery = 'INSERT INTO bus_arrivals (bus_stop_code, service_no, status, operator, originating_id, terminating_id, '
										+ '1_estimated_arrival, 1_latitude, 1_longitude, 1_visit_number, 1_load, 1_feature, '
										+ '2_estimated_arrival, 2_latitude, 2_longitude, 2_visit_number, 2_load, 2_feature, '
										+ '3_estimated_arrival, 3_latitude, 3_longitude, 3_visit_number, 3_load, 3_feature, last_updated) VALUES ';

							var busArrivals = [];

							var now = new Date();

							for (var i=0; i<serviceCount; i++) {
								var service = json['Services'][i];
								var status = util.ConvertBusStatusStrToInt(service['Status']);

								// convert load
								var loads = [
									util.ConvertBusLoadStrToInt(service['NextBus']['Load']), 
									util.ConvertBusLoadStrToInt(service['SubsequentBus']['Load']), 
									util.ConvertBusLoadStrToInt(service['SubsequentBus3']['Load'])
								];

								var subquery = mysqlLib.format('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()) ',
										[json['BusStopID'], service['ServiceNo'], status, service['Operator'], service['OriginatingID'], service['TerminatingID'], 
										service['NextBus']['EstimatedArrival'], service['NextBus']['Latitude'], service['NextBus']['Longitude'], service['NextBus']['VisitNumber'], loads[0], service['NextBus']['Feature'],
										service['SubsequentBus']['EstimatedArrival'], service['SubsequentBus']['Latitude'], service['SubsequentBus']['Longitude'], service['SubsequentBus']['VisitNumber'], loads[1], service['SubsequentBus']['Feature'],
										service['SubsequentBus3']['EstimatedArrival'], service['SubsequentBus3']['Latitude'], service['SubsequentBus3']['Longitude'], service['SubsequentBus3']['VisitNumber'], loads[2], service['SubsequentBus3']['Feature']]
								);

								sqlQuery += subquery;

								if (i + 1 < serviceCount) {
									sqlQuery += ', ';
								} else {
									sqlQuery += 'ON DUPLICATE KEY UPDATE status=VALUES(status), operator=VALUES(operator), originating_id=VALUES(originating_id), terminating_id=VALUES(terminating_id), '
										+ '1_estimated_arrival=VALUES(1_estimated_arrival), 1_latitude=VALUES(1_latitude), 1_longitude=VALUES(1_longitude), 1_visit_number=VALUES(1_visit_number), 1_load=VALUES(1_load), 1_feature=VALUES(1_feature), '
										+ '2_estimated_arrival=VALUES(2_estimated_arrival), 2_latitude=VALUES(2_latitude), 2_longitude=VALUES(2_longitude), 2_visit_number=VALUES(2_visit_number), 2_load=VALUES(2_load), 2_feature=VALUES(2_feature), '
										+ '3_estimated_arrival=VALUES(3_estimated_arrival), 3_latitude=VALUES(3_latitude), 3_longitude=VALUES(3_longitude), 3_visit_number=VALUES(3_visit_number), 3_load=VALUES(3_load), 3_feature=VALUES(3_feature), last_updated=NOW();'
								}

								// put the data into array to return
								var busArrival = {
									'bus_stop_code': json['BusStopID'],
									'service_no': service['ServiceNo'],
									'status': status,
									'operator': service['Operator'],
									'originating_id': service['OriginatingID'],
									'terminating_id': service['TerminatingID']
								};

								if (loads[0] != null) {
									busArrival['1_estimated_arrival'] = util.GetTimeDiff(now, new Date(service['NextBus']['EstimatedArrival']));
									busArrival['1_latitude'] = service['NextBus']['Latitude'];
									busArrival['1_latitude'] = service['NextBus']['Latitude'];
									busArrival['1_longitude'] = service['NextBus']['Longitude'];
									busArrival['1_visit_number'] = service['NextBus']['VisitNumber'];
									busArrival['1_load'] = loads[0];
									busArrival['1_feature'] = service['NextBus']['Feature'];
								}

								if (loads[1] != null) {
									busArrival['2_estimated_arrival'] = util.GetTimeDiff(now, new Date(service['SubsequentBus']['EstimatedArrival']));
									busArrival['2_latitude'] = service['SubsequentBus']['Latitude'];
									busArrival['2_latitude'] = service['SubsequentBus']['Latitude'];
									busArrival['2_longitude'] = service['SubsequentBus']['Longitude'];
									busArrival['2_visit_number'] = service['SubsequentBus']['VisitNumber'];
									busArrival['2_load'] = loads[1];
									busArrival['2_feature'] = service['SubsequentBus']['Feature'];
								}

								if (loads[2] != null) {
									busArrival['3_estimated_arrival'] = util.GetTimeDiff(now, new Date(service['SubsequentBus3']['EstimatedArrival']));
									busArrival['3_latitude'] = service['SubsequentBus3']['Latitude'];
									busArrival['3_latitude'] = service['SubsequentBus3']['Latitude'];
									busArrival['3_longitude'] = service['SubsequentBus3']['Longitude'];
									busArrival['3_visit_number'] = service['SubsequentBus3']['VisitNumber'];
									busArrival['3_load'] = loads[2];
									busArrival['3_feature'] = service['SubsequentBus3']['Feature'];
								}

								busArrivals.push(busArrival);
							}

							// save to db
	    					conn.query(sqlQuery, function(err) {
	    						if (err == null) {
									callback(null, busArrivals);
								} else { // if there's an error, straightaway jump to end
	    							callback(err.code);
	    						}
		    				});
	    				});
					});
				} else {
					callback(null, localBusArrivals);
				}
			}],
			getTerminatingBusStops: ['getBusArrivals', function(results, callback) {
				var busArrivals = results.getBusArrivals;

				var terminatingIds = [];
				var busStopCodeToIndex = {};
				for (var i=0; i<busArrivals.length; i++) {
					var terminatingId = busArrivals[i]['terminating_id'];

					if ((terminatingId in busStopCodeToIndex) == false) {
						busStopCodeToIndex[terminatingId] = [];
					}
					busStopCodeToIndex[terminatingId].push(i);
					terminatingIds.push(terminatingId);
				}

				var sqlQuery = 'SELECT bus_stop_code, description FROM bus_stops WHERE bus_stop_code IN (?);';

				conn.query(sqlQuery, [terminatingIds], function(err, dbResult) {
					if (err == null) {
						for (var i=0; i<dbResult.length; i++) {
							var busStopIndexes = busStopCodeToIndex[dbResult[i]['bus_stop_code']];
							for (var j=0; j<busStopIndexes.length; j++) {
								var busStopIndex = busStopIndexes[j];
								busArrivals[busStopIndex]['terminating_description'] = dbResult[i]['description'];
							}
						}

						callback(null, busArrivals);
					} else { // if there's an error, straightaway jump to end
						callback(err.code);
					}
				});

			}]
		}, function(err, results) {
			if (conn) {
				conn.release();
			}

			if (err != null) {
				util.ReturnError(res, err);
			} else {
				var data = {
					BusArrivals: results.getTerminatingBusStops
				};

			    res.end(JSON.stringify(data));
			}
		});
	});
};