# com-modbus
this is a wrapper for npm's [modbus-serial](https://www.npmjs.com/package/modbus-serial) library that handle modbus serial communication. This wrapper handle communication retry and data chunking for large data. 

Currently only tested on Linux (Debian-based).

## Installation
`npm i --save git://adrianaryaputra/com-modbus.git`

## Usage
```js
const SerialPort = require('serialport');
const { ModbusHandler, ModbusDevice } = require('com-modbus');


// set serial port
const port = new SerialPort('/dev/tty-usbserial1', {
  baudRate: 57600
})


// set modbus handler and device
let modbusHandler = new ModbusHandler({
    msgSendInterval: 100,
    timeout: 100,
    retryCount: 10,
    chunkSizeWord: 4,
});

let modbusDevice = new ModbusDevice({
    modbusHandler,
    modbusId: 1,
    modbusTimeout: 100,
});


// set modbus handler's serial port connection 
modbusHandler.setConnection(port).open();


// send modbus (read / write)
modbusDevice.send({
    modbusCmd: modbusDevice.modbusCmd.readHoldingRegisters, 
    address: 30,
    length: 2,
    priority: 2, // lower have higher priority
    callback: (error, success) => {}
});
```