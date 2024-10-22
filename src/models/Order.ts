import { OrderItemType, OrderType, ShippingInfoType } from '@/interfaces/Order';
import mongoose from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

const orderItemSchema = new mongoose.Schema<OrderItemType>(
  {
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    sku_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sku",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    price_before_discount: {
      type: Number,
      default: 0,
    },
    price_discount_percent: {
      type: Number,
      default: 0,
    },
    total_money: {
      type: Number,
      default: 0,
    },
  },
  {
    collection: "order_details",
    timestamps: true,
    versionKey: false,
  }
);

const shippingInfoSchema = new mongoose.Schema<ShippingInfoType>(
  {
    shipping_address: {
      type: String,
      required: true,
    },
    estimated_delivery_date: Date,
    shipping_company: {
      type: String,
      default: "Giao hàng nhanh",
    },
    transportation_fee: {
      type: Number,
      default: 0,
    },
    order_code: {
      type: String,
    },
  },
  {
    collection: "shippings",
    timestamps: true,
    versionKey: false,
  }
);

// Định nghĩa schema cho Order
const orderSchema = new mongoose.Schema<OrderType>(
  {
    customer_name: {
      type: String,
      required: true,
    },
    total_amount: {
      type: Number,
      required: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    coupon_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
    },
    shop_address: {
      type: String,
    },
    phone_number: {
      type: Number,
      required: true,
    },
    payment_status: {
      type: String,
      enum: ["paid", "unpaid"],
      default: "unpaid",
    },
    payment_method: {
      type: Object,
    },
    status: {
      type: String,
      default: "processing",
      enum: [
        "processing",
        "confirmed",
        "delivering",
        "cancelled",
        "pendingComplete",
        "delivered",
        "returned",
      ],
    },
    status_detail: [
      {
        status: {
          type: String,
          default: "processing",
          enum: [
            "processing",
            "confirmed",
            "delivering",
            "cancelled",
            "delivered",
            "returned",
          ],
        },
        created_at: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    date_issued: {
      type: Date,
      default: Date.now,
    },
    content: {
      type: String,
    },
    shipping_method: {
      type: String,
      enum: ["shipped", "at_store"],
      default: "at_store",
    },
    shipping_info: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shipping",
    },
  },
  {
    collection: "orders",
    timestamps: true,
    versionKey: false,
  }
);


orderSchema.plugin(mongoosePaginate);

const OrderItem = mongoose.model<OrderItemType>('OrderDetail', orderItemSchema);
const ShippingInfo = mongoose.model<ShippingInfoType>('Shipping', shippingInfoSchema);
const Order = mongoose.model<OrderType>('Order', orderSchema);

export { Order, ShippingInfo, OrderItem };
