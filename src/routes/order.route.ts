import {
  cancelOrder,
  cancelReturnedOrder,
  confirmRefundedOrder,
  confirmReturnedOrder,
  createNewOrder,
  decreaseProductFromOrder,
  getAllOrders,
  getAllShipping,
  getAllUserOrders,
  getOneOrder,
  getOrderByPhoneNumber,
  getOrderByUserId,
  getRefundedOrder,
  getReturnedOrder,
  increaseProductFromOrder,
  refundedOrder,
  removeProductFromOrder,
  returnedOrder,
  serviceCalFee,
  updateInfoCustomer,
  updatePaymentStatus,
  updatePaymentStatusOrder,
  updateStatusDelivered,
  updateStatusOrder,
} from '@/controllers/order.controller';
import { checkAuth } from '@/middlewares/checkAuth';
import { Router } from 'express';

const routeOrder = Router();
routeOrder.put('/decrement', decreaseProductFromOrder);
routeOrder.put('/increment', increaseProductFromOrder);
routeOrder.put('/decrement-product-order', removeProductFromOrder);
routeOrder.post('/payment-status', updatePaymentStatus);
routeOrder.post('/calculateFee', serviceCalFee);
routeOrder.put('/orderByPhoneNumber', getOrderByPhoneNumber);
//* Get order by user id
routeOrder.get('/orderByUserId', getOrderByUserId);
routeOrder.post('/return', returnedOrder);
routeOrder.get('/return', getReturnedOrder);
routeOrder.put('/return/:id', confirmReturnedOrder);
routeOrder.put('/return/:id/reject', cancelReturnedOrder);
routeOrder.post('/refund', refundedOrder);
routeOrder.get('/refund', getRefundedOrder);
routeOrder.put('/refund/:id', confirmRefundedOrder);
routeOrder.put('/confirm-completed/:id', updateStatusDelivered);
//* Create new order
routeOrder.post('/', checkAuth, createNewOrder);
routeOrder.get('/', getAllOrders);
//* Get all orders exist
routeOrder.get('/statistical', getAllUserOrders);
routeOrder.get('/shipping', getAllShipping);
//* Get order by order id
routeOrder.get('/:id', getOneOrder);
//* Cancel order by id
routeOrder.patch('/cancel/:id', checkAuth, cancelOrder);
//* Update order status
routeOrder.put('/updateStatusPayment/:id', checkAuth, updatePaymentStatusOrder);
routeOrder.put('/updateStatusOrder/:id', checkAuth, updateStatusOrder);
routeOrder.put('/updateInfoCustomer/:id', updateInfoCustomer);

export default routeOrder;
