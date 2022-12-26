const app = require('./app');
const http = require('http');
const {cpus} = require("os");
const cluster = require("cluster");
const numCPUs = cpus().length;
if(cluster.isPrimary){
 
    console.log(`Primary ${process.pid} is running`);
  
    // Fork workers.
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }
  
    cluster.on('exit', (worker, code, signal) => {
      console.log(`worker ${worker.process.pid} died`);
    });
}else{
  http.createServer(app).listen(3001);

  console.log(`Worker ${process.pid} started`);
  //init();
}





async function init() {
  try {
    app.listen(3001, () => {
      console.log('Express App Listening on Port 3001');
    });
  } catch (error) {
    console.error(`An error occurred: ${JSON.stringify(error)}`);
    process.exit(1);
  }
}
