var config = {
	web: {
		port: 8000
	},
	sql: {
		host: 'localhost',
    	user: 'root',
    	password: '',
    	database: 'sgbus',
    	connectionLimit: 200
	},
	datamall: {  // lta datamall
		AccountKey: '<example key>',
		UniqueUserID: '<example id>'
	},
	constants: {
		BusStopDistance: 0.5 // within 0.5km
	}
};

module.exports = config;