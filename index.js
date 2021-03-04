const ModbusRTU = require("modbus-serial");
const SerialPort = require("serialport");

class ModbusHandler {



    constructor({
        msgSendInterval = 200, 
        timeout = 500,
        retryCount = 3,
        chunkSizeWord = 4,
    }) {
        this.timeout = timeout;
        this.retryCount = retryCount-1;
        this.chunkSizeWord = chunkSizeWord;
        this.msgSendInterval = msgSendInterval;
        
        this.messageBuffer = new Array();
        this.isOpen = false;
    }



    setConnection(port) {
        this.connection = new ModbusRTU(port);
        return this;
    }



    open(next) {
        this.connection.open(() => {
            this.modbusSender = setInterval(() => this._modbusSend(), this.msgSendInterval);
            this.isOpen = true;
            next();
        });
        this.connection.setTimeout(this.timeout);
        return this;
    }



    close(next) {
        // this.connection.close(next);
        this.isOpen = false;
        clearInterval(this.modbusSender);
    }



    send({ 
        modbusId,
        modbusSendCommand, 
        modbusSendArgs,
        modbusPriority = 1,
        modbusRetryCount = this.retryCount,
        modbusCallback = ()=>{},
        _chunkBuffer = new Array(),
        _chunkCallback = ()=>{},
    }) {

        // chunking
        let chunks = this._modbusChunking({
            modbusId,
            modbusSendCommand, 
            modbusSendArgs,
            modbusPriority,
            modbusRetryCount,
            modbusCallback,
            _chunkBuffer,
            _chunkCallback
        })

        // list all similar modbus send command in buffer
        let similar = this.messageBuffer.filter((obj) => (
            obj.modbusId == modbusId &&
            obj.modbusSendCommand == modbusSendCommand &&
            JSON.stringify(obj.modbusSendArgs) == JSON.stringify(modbusSendArgs)
        ))

        // do not add to buffer if similar object already exist in buffer
        if(similar.length == 0) {
            this.messageBuffer.push(chunks);
        }

        return this;
    }



    _modbusSend() {
        if(this.messageBuffer) {
            this.messageBuffer.sort((a,b) => a.modbusPriority - b.modbusPriority);
            let msg = this.messageBuffer.shift();
            if(msg) {
                // set argument
                let args = [ 
                    msg.modbusId, 
                    ...msg.modbusSendArgs, 
                    (error, data) => this._handleChunkCallback(msg, error, data, msg._chunkCallback) 
                ]
                // send modbus command
                this._modbusSendCommand(msg.modbusSendCommand, args);
            }
        }
    }



    _modbusSendCommand(command, args) {

        switch(command) {
            case ModbusCommand.readCoils:
                args[2] = (args[2] > this.chunkSizeWord) ? this.chunkSizeWord : args[2];
                this.connection.writeFC1(...args)
                break;
            case ModbusCommand.readDiscreteInputs:
                args[2] = (args[2] > this.chunkSizeWord) ? this.chunkSizeWord : args[2];
                this.connection.writeFC2(...args)
                break;
            case ModbusCommand.readHoldingRegisters:
                args[2] = (args[2] > this.chunkSizeWord) ? this.chunkSizeWord : args[2];
                this.connection.writeFC3(...args)
                break;
            case ModbusCommand.readInputRegisters:
                args[2] = (args[2] > this.chunkSizeWord) ? this.chunkSizeWord : args[2];
                this.connection.writeFC4(...args)
                break;
            case ModbusCommand.writeCoil:
                this.connection.writeFC5(...args)
                break;
            case ModbusCommand.writeRegister:
                this.connection.writeFC6(...args)
                break;
            case ModbusCommand.writeCoils:
                args[2] = args[2].slice(0,4);
                this.connection.writeFC15(...args)
                break;
            case ModbusCommand.writeRegisters:
                args[2] = args[2].slice(0,4);
                this.connection.writeFC16(...args)
                break;
        }
    }



    _modbusChunking({ 
        modbusId,
        modbusSendCommand, 
        modbusSendArgs,
        modbusPriority,
        modbusRetryCount,
        modbusCallback,
        _chunkBuffer,
        _chunkCallback
    }) {

        let address = modbusSendArgs[0];
        let vals = modbusSendArgs[1];

        switch(modbusSendCommand) {
            // if modbus read command
            case ModbusCommand.readCoils:
            case ModbusCommand.readDiscreteInputs:
            case ModbusCommand.readHoldingRegisters:
            case ModbusCommand.readInputRegisters:
                if(vals > this.chunkSizeWord) {
                    // generate chunks callback function
                    let chunkFn = (error, success) => {
                        if(success) {
                            _chunkBuffer.push(success);
                            // send next chunk
                            this.send({
                                modbusId,
                                modbusSendCommand,
                                modbusSendArgs: [address+this.chunkSizeWord, vals-this.chunkSizeWord],
                                modbusPriority,
                                modbusCallback,
                                _chunkBuffer,
                                _chunkCallback
                            })
                        }
                        if(error && modbusRetryCount == 0) modbusCallback(error, success);
                    };
                    return new Object({
                        modbusId,
                        modbusSendCommand, 
                        modbusSendArgs: [address, vals],
                        modbusPriority,
                        modbusRetryCount,
                        modbusCallback,
                        _chunkBuffer,
                        _chunkCallback: chunkFn,
                    });
                }
                break;

            // if modbus write command
            case ModbusCommand.writeCoils:
            case ModbusCommand.writeRegisters:
                if(Array.isArray(vals)) {
                    if(vals.length > this.chunkSizeWord) {
                        // generate chunks callback function
                        let chunkFn = (error, success) => {
                            if(success) {
                                _chunkBuffer.push(success);
                                // send next chunk
                                this.send({
                                    modbusId,
                                    modbusSendCommand,
                                    modbusSendArgs: [address+this.chunkSizeWord, vals.slice(4)],
                                    modbusPriority,
                                    modbusCallback,
                                    _chunkBuffer: _chunkBuffer,
                                    _chunkCallback
                                })
                            }
                        };
                        return new Object({
                            modbusId,
                            modbusSendCommand, 
                            modbusSendArgs: [address, vals],
                            modbusPriority,
                            modbusRetryCount,
                            modbusCallback,
                            _chunkBuffer,
                            _chunkCallback: chunkFn,
                        });
                    }
                }
                break;
        }

        // flatten the chunkBuffer if this is the last chunk;
        return new Object({
            modbusId,
            modbusSendCommand, 
            modbusSendArgs,
            modbusPriority,
            modbusRetryCount,
            modbusCallback,
            _chunkBuffer,
            _chunkCallback: (error, success) => {
                if(success) {
                    _chunkBuffer.push(success);
                    // flatten the chunkBuffer
                    success = _chunkBuffer.reduce((reducer, value) => { 
                        if(value.data) return reducer.concat(value.data.slice(0, 4));
                        if(value.value !== undefined) return reducer.concat(value.value);
                        if(value.state !== undefined) return reducer.push(value.state);
                    }, []);
                }
                if((success !== null && success !== undefined) || (error && modbusRetryCount == 0)) {
                    if(Array.isArray(success)) if(success.length==1) success = success[0];
                    modbusCallback(error, success);
                }
            }
        });
    }



    _handleChunkCallback(msg, error, data, chunkCallback) {
        if(error) {
            msg.modbusRetryCount -= 1;
            if(msg.modbusRetryCount >= 0) this.send(msg);
        };
        chunkCallback(error, data);
    }



}





class ModbusDevice {



    constructor({
        modbusHandler,
        modbusId,
        modbusTimeout,
    }){
        this.id = modbusId;
        this.timeout = modbusTimeout;
        this.handler = modbusHandler;
        this.modbusCmd = ModbusCommand;
    }



    send({
        modbusCmd,
        address,
        length,
        priority,
        callback,
    }) {
        this.handler.send({ 
            modbusId: this.id,
            modbusSendCommand: modbusCmd, 
            modbusSendArgs: [address, length],
            modbusPriority: priority,
            modbusCallback: callback,
        });
    }


    
}





let ModbusCommand = Object.freeze({
    readCoils: 'FC1',
    readDiscreteInputs: 'FC2',
    readHoldingRegisters: 'FC3',
    readInputRegisters: 'FC4',
    writeCoil: 'FC5',
    writeRegister: 'FC6',
    writeCoils: 'FC15',
    writeRegisters: 'FC16',
})





module.exports = {
    ModbusHandler,
    ModbusDevice,
    ModbusCommand,
    SerialPort,
    TcpPort: ModbusRTU.TcpPort,
    TelnetPort: ModbusRTU.TelnetPort,
    C701Port: ModbusRTU.C701Port,
}