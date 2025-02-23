import {
  changePassword,
  forgotPassword,
  generateVerifyToken,
  getAllUser,
  getOneUser,
  updateUser,
  verifyEmailToken,
} from '@/controllers/user.controller';
import { checkAuth } from '@/middlewares/checkAuth';
import { Router } from 'express';

const routeUser = Router();
//* Get all users exist
routeUser.get(
  '/',
  checkAuth,
  // checkPermission,
  // #swagger.tags = ['User']
  getAllUser,
);

//* Get one user
routeUser.get(
  '/:id',
  // #swagger.tags = ['User']
  getOneUser,
);

//* Update user
routeUser.patch(
  '/:id',
  // #swagger.tags = ['User']
  updateUser,
);

//* Generate verify token form user
routeUser.post(
  '/generateVerificationToken',
  // #swagger.tags = ['User']
  generateVerifyToken,
);

//* Verify token from email sending
routeUser.post(
  '/verifyToken',
  // #swagger.tags = ['User']
  verifyEmailToken,
);

//* Forgot password
routeUser.post(
  '/forgotPassword',
  // #swagger.tags = ['User']
  forgotPassword,
);

//* Change password
routeUser.post(
  '/changePassword',
  // #swagger.tags = ['User']
  changePassword,
);

export default routeUser;
