import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import swagger from 'docs/swagger-output.json';
import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import morgan from 'morgan';
import { Server } from 'socket.io';
import swaggerUI from 'swagger-ui-express';
import redirectPath from './middlewares/redirectPath';
import router from './routes';
import { PORT } from './utils/env';
import { errorHandle, errorHandleNotFound } from './utils/errorHandle';
import logger from './utils/logger';
import { realTime } from './utils/socket';
const app = express(),
  //* Create server real time
  server = createServer(app),
  io = new Server(server, {
    cors: {
      origin: '*',
    },
  });

//* Init Middleware
app.use(
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(
  express.urlencoded({
    extended: true,
  }),
);
const Stream = {
  write: (text: string) => {
    logger.log('info', text.replace(/\n$/, ''));
  },
};
app.use(helmet());
app.use(compression());
app.use(morgan('dev', { stream: Stream }));
app.use(redirectPath);

//* Init Database
import '@/db/init.mongo';

//* Init chat real time
realTime(io);
//* Init Route
app.use('/api/v1', router);
app.use('/api/docs', swaggerUI.serve, swaggerUI.setup(swagger));
//* Error Handling
app.use(errorHandleNotFound, errorHandle);

app.listen(PORT, () => {
  logger.log('info', `Listen on port ${PORT}`);
});

// TODO: Update logging in every throw error
// TODO: Spilt logic in payment and shipment into service
// TODO: Fix logic in order and split into service
