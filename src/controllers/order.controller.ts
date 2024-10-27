import Cart from "@/models/Cart";
import { createMomo, createVnPay, createZaloPay } from "./payment.controller";
import { messagesError, messagesSuccess } from "@/constants/messages";
import { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import createError from "http-errors";
import { Sku } from "@/models/Sku";
import { Order, Order_Detail, Shipping } from "@/models/Order";
import mongoose from "mongoose";
import moment from "moment";
import { calculateFee, getAddressLocation } from "@/utils/shipment";
import axios from "axios";
import { Returned } from "@/models/Return";

///// Client

export const CreateOrder: RequestHandler = async (req, res, next) => {
  try {
    const {
      address,
      shipping_address,
      payment_method,
      total_amount,
      transportation_fee = 3000,
      guestId,
      cart_id,
      ...body
    } = req.body;

    let paymentMethod;
    try {
      paymentMethod = buildPaymentMethod(payment_method);
    } catch (error: any) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ message: error.message });
    }

    // Kiểm tra phương thức thanh toán và gọi API tương ứng
    let payUrl: string | undefined;
    try {
      switch (payment_method) {
        case "momo":
          const momoResponse: any = await createMomo(req, res, next);
          payUrl = momoResponse?.payUrl ?? "";
          break;

        case "zalopay":
          const zalopayResponse: any = await createZaloPay(req, res, next);
          payUrl = zalopayResponse?.payUrl ?? "";
          break;

        case "vnpay":
          const vnpayResponse: any = await createVnPay(req, res, next);
          payUrl = vnpayResponse?.payUrl ?? "";
          break;
        default:
          throw new Error("Phương thức thanh toán không hợp lệ");
      }

      // Kiểm tra xem payUrl có hợp lệ không
      if (!payUrl) {
        throw new Error("Không thể lấy liên kết thanh toán từ phản hồi.");
      }
    } catch (error: any) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ message: error.message });
    }

    // Tạo đơn hàng với thông tin thanh toán
    const order = await Order.create({
      ...body,
      total_amount: Number(total_amount) + transportation_fee,
      payment_method: paymentMethod,
      payment_url: payUrl, // Đính kèm liên kết thanh toán
    });

    // Tạo thông tin giao hàng nếu phương thức giao hàng là "shipped"
    if (order.shipping_method === "shipped") {
      await createShippingInfo(
        order,
        address,
        shipping_address,
        transportation_fee
      );
    }

    // Cập nhật giỏ hàng
    await Cart.findOneAndUpdate(
      { cart_id },
      { $set: { products: [], total_money: 0 } }
    );

    // Trả về phản hồi đơn hàng cùng với liên kết thanh toán
    res.status(StatusCodes.OK).json({
      message: messagesSuccess.CREATE_ORDER_SUCCESS,
      res: {
        ...order.toObject(),
        payment_method: order.payment_method,
        payment_url: order.payment_url, // Đính kèm liên kết thanh toán
      },
    });
  } catch (error) {
    console.error("Lỗi khi tạo đơn hàng:", error);
    next(error);
  }
};

export const buildPaymentMethod = (method: string) => {
  switch (method) {
    case "cash":
      return {
        method: "Thanh toán khi nhận hàng",
        status: "unpaid",
        orderInfo: "Thanh toán trực tiếp",
        orderType: "cash",
        partnerCode: "TIENMAT",
      };
    case "momo":
      return {
        method: "Thanh toán qua ví MOMO",
        status: "unpaid",
        orderInfo: "Thanh toán qua MOMO",
        orderType: "bank_transfer",
        partnerCode: "BANKTRANSFER",
      };
    case "vnpay":
      return {
        method: "Thanh toán qua VNPAY",
        status: "unpaid",
        orderInfo: "Thanh toán qua VNPAY",
        orderType: "vnpay",
        partnerCode: "VNPAY",
      };
    case "zalopay":
      return {
        method: "Thanh toán qua ZALOPAY",
        status: "unpaid",
        orderInfo: "Thanh toán qua ZALOPAY",
        orderType: "zalopay",
        partnerCode: "ZALOPAY",
      };
    default:
      throw new Error("Phương thức thanh toán không hợp lệ");
  }
};

export const createShippingInfo = async (
  order: any,
  address: string,
  shipping_address: string,
  transportation_fee: number
) => {
  const detail_address = `${address},${shipping_address}`;
  const shippingInfo = await Shipping.create({
    shipping_address: detail_address,
    transportation_fee,
  });
  order.shipping_info = shippingInfo._id;
  await order.save();
};

// Hàm xử lý yêu cầu hoàn trả đơn hàng
export const returnedOrder: RequestHandler = async (req, res, next) => {
  try {
    // Phân tách thông tin từ body của yêu cầu
    const { order_id, reason, customer_name, phone_number, images } =
      req.body as {
        order_id: string; // ID của đơn hàng
        reason: string; // Lý do hoàn trả
        customer_name: string; // Tên khách hàng
        phone_number: string; // Số điện thoại của khách hàng
        images: string[]; // Hình ảnh chứng minh yêu cầu hoàn trả
      };

    // Kiểm tra xem đã có yêu cầu hoàn trả cho đơn hàng này chưa
    const return_order = await Returned.findOne({ order_id });
    if (return_order) {
      throw createError.BadRequest("Đơn hàng đã được yêu cầu hoàn hàng"); // Nếu đã có, trả về lỗi
    }

    // Tìm kiếm đơn hàng theo order_id
    const order = await Order.findById(order_id);
    // Xử lý khi order là null
    if (!order) {
      throw createError.NotFound("Đơn hàng không tìm thấy");
    }
    // Kiểm tra trạng thái đơn hàng, phải là 'delivered' để hoàn trả
    if (order.status === "returned" || order.status !== "delivered") {
      throw createError.BadRequest("Trạng thái đơn hàng không thể hoàn"); // Nếu không thể hoàn trả, trả về lỗi
    }

    // Tạo yêu cầu hoàn trả mới
    const returned = await Returned.create({
      order_id,
      reason,
      customer_name,
      phone_number,
      images,
    });

    // Kiểm tra xem yêu cầu hoàn trả đã được tạo thành công chưa
    if (!returned) throw createError.BadRequest("Hoàn hàng không thành công");

    return res.json({
      status: 200,
      message: "Tạo yêu cầu hoàn hàng thành công",
      data: returned,
    });
  } catch (error) {
    next(error);
  }
};

// Tính tiền vận chuyển
export const serviceFree: RequestHandler = async (req, res, next) => {
  try {
    const location = req.body;
    const code_location = await getAddressLocation(location); // Lấy thông tin địa điểm
    // Kiểm tra xem code_location có tồn tại không
    if (!code_location) {
      throw createError.BadRequest(
        "Không thể lấy thông tin địa chỉ từ vị trí đã cho"
      );
    }

    // Dữ liệu để tính phí
    const data = {
      from_district_id: 1915,
      from_ward_code: "1B2128",
      service_id: 53320,
      service_type_id: null,
      to_district_id: code_location.district.DistrictID,
      to_ward_code: code_location.ward_code,
      height: 50,
      length: 20,
      weight: 200,
      width: 20,
      insurance_value: 10000,
      cod_failed_amount: 2000,
      coupon: null,
    };

    // Tính tổng tiền vận chuyển
    const total_money = await calculateFee(data as any);

    // Kiểm tra mã phản hồi
    if (total_money.code !== 200) {
      throw createError.BadRequest("Không thể tính phí vận chuyển");
    }

    return res.json({
      status: 200,
      message: "thành công",
      data: total_money.data.total,
    });
  } catch (error) {
    next(error);
  }
};

// hàm xử lý yêu cầu thêm sản phẩm vào đơn hàng
export const addOneProduct_order: RequestHandler = async (req, res, next) => {
  try {
    const { order_id, sku_id } = req.body; // Lấy order_id và sku_id từ thân yêu cầu

    // Tìm chi tiết đơn hàng tương ứng với order_id và sku_id
    const orderDetail = await Order_Detail.findOne({
      $and: [{ order_id }, { sku_id }],
    });

    // Kiểm tra nếu không tìm thấy chi tiết đơn hàng
    if (!orderDetail) {
      throw createError.NotFound("Không tìm thấy sản phẩm"); // Ném lỗi 404
    }

    // Tìm SKU dựa trên sku_id
    const sku = await Sku.findById(sku_id);
    // Kiểm tra nếu không tìm thấy SKU
    if (!sku) {
      throw createError.NotFound("Không tìm thấy SKU"); // Ném lỗi 404
    }

    // Kiểm tra nếu số lượng kho nhỏ hơn số lượng trong chi tiết đơn hàng
    if (sku.stock < orderDetail.quantity) {
      throw createError.NotFound("Sản phẩm quá số lượng"); // Ném lỗi 404
    } else {
      // Giảm số lượng kho xuống 1
      const new_stock = sku.stock - 1;
      // Cập nhật số lượng kho trong cơ sở dữ liệu
      await Sku.findByIdAndUpdate(sku_id, {
        $set: { stock: new_stock },
      });
    }

    // Tăng số lượng sản phẩm trong chi tiết đơn hàng
    orderDetail.quantity++;
    // Cập nhật tổng tiền dựa trên số lượng và giá
    orderDetail.total_money = orderDetail.quantity * orderDetail.price;
    // Lưu thay đổi vào cơ sở dữ liệu
    await orderDetail.save();

    // Tìm tất cả chi tiết đơn hàng dựa trên order_id
    const orderDetails = await Order_Detail.find({ order_id });
    // Tính tổng tiền của đơn hàng
    const total_amount = orderDetails.reduce((total, amount) => {
      return total + (amount.total_money ?? 0); // Cộng tổng tiền, nếu không có thì tính là 0
    }, 0);

    // Cập nhật tổng tiền cho đơn hàng
    const new_order = await Order.findByIdAndUpdate(
      order_id,
      {
        $set: { total_amount }, // Cập nhật tổng tiền
      },
      { new: true } // Trả về tài liệu đã cập nhật
    );

    // Gửi phản hồi thành công với thông tin đơn hàng đã cập nhật
    return res.json({
      status: 200,
      message: "Cập nhật thành công",
      data: new_order, // Dữ liệu của đơn hàng mới
    });
  } catch (error) {
    next(error);
  }
};

///// Admin

// Lấy danh sách đơn hàng với các tùy chọn tìm kiếm, sắp xếp và phân trang.
export const getAll: RequestHandler = async (req, res, next) => {
  const {
    _page = "1", // Trang mặc định là 1
    _sort = "created_at", // Sắp xếp theo trường created_at mặc định
    _order = "desc", // Thứ tự sắp xếp mặc định là giảm dần
    _limit = "10", // Giới hạn số bản ghi trả về là 10
    search, // Từ khóa tìm kiếm
    status, // Trạng thái đơn hàng
    date, // Ngày để lọc
    payment_method, // Phương thức thanh toán
    payment_status, // Trạng thái thanh toán
  } = req.query;

  const sortField = typeof _sort === "string" ? _sort : "created_at";
  // Khởi tạo đối tượng điều kiện tìm kiếm
  const conditions: any = {};

  // Nếu có từ khóa tìm kiếm, thêm điều kiện vào đối tượng
  if (search && typeof search === "string") {
    // Kiểm tra nếu search là chuỗi
    conditions.$or = [
      { customer_name: { $regex: new RegExp(search, "i") } }, // Sử dụng search khi chắc chắn là chuỗi
      {
        _id: mongoose.Types.ObjectId.isValid(search)
          ? new mongoose.Types.ObjectId(search)
          : null,
      },
    ];
  }

  // Thêm điều kiện trạng thái nếu có
  if (status) {
    conditions.status = status;
  }

  // Thêm điều kiện trạng thái thanh toán nếu có
  if (payment_status) {
    conditions.payment_status = payment_status;
  }

  // Nếu có tham số ngày, thiết lập điều kiện cho ngày tạo
  if (date && typeof date === "string") {
    const targetMoment = moment(date); // Phân tích tham số ngày bằng moment
    const yearToSearch = targetMoment.year(); // Lấy năm
    const monthToSearch = targetMoment.month(); // Lấy tháng
    const dayToSearch = targetMoment.date(); // Lấy ngày

    // Thiết lập điều kiện để tìm các đơn hàng được tạo trong ngày đó
    conditions.created_at = {
      $gte: new Date(yearToSearch, monthToSearch, dayToSearch), // Ngày lớn hơn hoặc bằng
      $lt: new Date(yearToSearch, monthToSearch, dayToSearch + 1), // Ngày nhỏ hơn ngày hôm sau
    };
  }

  // Thêm điều kiện phương thức thanh toán nếu có
  if (payment_method) {
    conditions["payment_method.partnerCode"] = payment_method; // Tìm theo partnerCode
  }

  // Thiết lập tùy chọn cho truy vấn
  const options = {
    _page, // Trang hiện tại
    _limit, // Giới hạn số bản ghi
    sort: {
      // Thiết lập sắp xếp
      [sortField]: _order === "desc" ? -1 : 1, // Nếu _order là 'desc', sắp xếp giảm dần, ngược lại sắp xếp tăng dần
    },
    select: ["-deleted", "-deleted_at"], // Loại bỏ các trường không cần thiết
  };

  try {
    // Thực hiện truy vấn và phân trang
    const { docs, ...paginate } = await Order.paginate(conditions, options);

    // Kiểm tra nếu không có đơn hàng nào được tìm thấy
    if (!docs.length) {
      return res
        .status(StatusCodes.NOT_FOUND) // Trả về mã trạng thái 404
        .json({ message: messagesError.NOT_FOUND });
    }

    // Lấy chi tiết cho từng đơn hàng
    const new_docs = await Promise.all(
      docs.map(async (item: any) => {
        const order_details = await Order_Detail.find({ order_id: item._id }); // Lấy chi tiết sản phẩm của đơn hàng
        const orders = item.toObject(); // Chuyển đổi đơn hàng sang đối tượng
        return {
          ...orders, // Kết hợp các trường của đơn hàng
          products: order_details, // Thêm thông tin sản phẩm vào đơn hàng
        };
      })
    );

    // Gửi phản hồi thành công với dữ liệu đơn hàng và thông tin phân trang
    return res.json({
      status: 200, // Mã trạng thái 200
      message: messagesSuccess.GET_PRODUCT_SUCCESS, // Thông điệp thành công
      data: {
        items: new_docs, // Danh sách đơn hàng đã lấy
        paginate, // Thông tin phân trang
      },
    });
  } catch (error) {
    next(error); // Chuyển lỗi cho middleware xử lý lỗi
  }
};

// cập nhật trạng thái của một đơn hàng
export const updateStatus: RequestHandler = async (req, res, next) => {
  try {
    // Lấy ID của đơn hàng từ tham số đường dẫn (URL)
    const id = req.params.id;

    // Lấy trạng thái mới từ yêu cầu (request body)
    const status = req.body;

    // Danh sách các trạng thái hợp lệ
    const array_status = [
      "processing",
      "confirmed",
      "delivering",
      "pendingComplete",
      "cancelled",
      "delivered",
      "returned",
    ];

    // Kiểm tra xem trạng thái mới có nằm trong danh sách trạng thái hợp lệ hay không
    if (!array_status.includes(status)) {
      throw createError.BadRequest("Trạng thái không hợp lệ"); // Nếu không, ném lỗi 400
    }

    // Tìm kiếm đơn hàng trong cơ sở dữ liệu bằng ID
    const ordered = await Order.findById(id);

    // Kiểm tra xem đơn hàng có tồn tại không
    if (!ordered) {
      throw createError.NotFound("Không tìm thấy đơn hàng"); // Nếu không, ném lỗi 404
    }

    // Tìm kiếm chi tiết đơn hàng dựa trên ID của đơn hàng
    const order_details = await Order_Detail.find({ order_id: id });

    // Kiểm tra trạng thái hiện tại của đơn hàng
    const check_status = ordered.status_detail?.find(
      (item) => item.status === status // Tìm trạng thái mới trong chi tiết trạng thái của đơn hàng
    );

    // Kiểm tra các điều kiện không cho phép cập nhật trạng thái
    if (ordered.status === "cancelled") {
      throw createError.BadRequest("Đơn hàng đã được huỷ");
    }
    if (ordered.status === "delivered") {
      throw createError.BadRequest("Đơn hàng đã được hoàn thành");
    }
    if (check_status) {
      throw createError.BadRequest("Trạng thái đã tồn tại");
    }
    if (ordered.status === status) {
      throw createError.BadRequest("Trạng thái không thay đổi");
    }
    if (status === "returned") {
      throw createError.BadRequest("Không thể huỷ đơn hàng đã hoàn");
    }
    if (status === "delivered") {
      throw createError.BadRequest(
        "Đợi xác nhận từ khách hàng để hoàn thành đơn"
      );
    }

    // Nếu trạng thái mới là "confirmed" và phương thức vận chuyển là "shipped"
    if (status === "confirmed" && ordered.shipping_method === "shipped") {
      // Tìm thông tin giao hàng dựa trên thông tin shipping_info của đơn hàng
      const shipping = await Shipping.findOne({ _id: ordered.shipping_info });

      // Kiểm tra xem thông tin giao hàng có tồn tại không
      if (!shipping) {
        throw createError.NotFound(
          "Không tìm thấy thông tin giao hàng cho đơn hàng này"
        );
      }

      // Hàm lấy thông tin SKU dựa trên ID
      const get_sku = async (sku_id: string) => {
        const new_item = await Sku.findById(sku_id);
        return new_item; // Trả về thông tin SKU
      };

      // Lấy thông tin chi tiết đơn hàng mới bằng cách tìm thông tin SKU cho từng mục
      const new_order_details = await Promise.all(
        order_details.map(async (item) => {
          const data_sku = await get_sku(item.sku_id.toString());
          // Kiểm tra nếu không tìm thấy SKU
          if (!data_sku) {
            throw new Error(`SKU with ID ${item.sku_id} not found`); // Ném lỗi nếu không tìm thấy
          }
          return {
            _id: item._id,
            sku_id: data_sku._id,
            name: data_sku.name,
            price: data_sku.price,
            price_before_discount: data_sku.price_before_discount,
            price_discount_percent: data_sku.price_discount_percent,
            image: data_sku.image,
            quantity: item.quantity,
            total_money: item.total_money,
          };
        })
      );

      // Tách địa chỉ giao hàng thành các phần
      const address_detail = shipping.shipping_address.split(",");
      const address = address_detail.shift(); // Lấy phần địa chỉ chính
      const code_ward_district = await getAddressLocation(
        address_detail.join(",") // Gọi hàm lấy mã phường/xã và quận/huyện từ địa chỉ
      );
      // Kiểm tra xem có lấy được thông tin mã phường/xã và quận/huyện không
      if (!code_ward_district) {
        throw createError.NotFound(
          "Không thể lấy mã phường/xã và quận/huyện từ địa chỉ" // Nếu không lấy được
        );
      }

      // Dữ liệu để gửi đi cho API tạo đơn hàng mới
      const data_shipping = {
        to_name: ordered.customer_name,
        to_phone: ordered.phone_number,
        to_address: shipping.shipping_address,
        to_ward_code: code_ward_district.ward_code,
        to_district_id: code_ward_district.district.DistrictID, // Lấy DistrictID từ district
        content: ordered.content,
        weight: 10, // Ví dụ: trọng lượng của một chiếc tủ
        length: 100, // Chiều dài 100 cm
        width: 90, // Chiều rộng 60 cm
        height: 75, // Chiều cao 75 cm
        service_type_id: 2,
        service_id: 53319,
        payment_type_id: 1,
        required_note: "CHOXEMHANGKHONGTHU",
        Items: new_order_details,
        name: "Đồ nội thất",
        quantity: new_order_details.length,
      };

      // Gọi API tạo đơn hàng mới
      const orderCode = await axios.post(
        "https://dev-online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/create",
        data_shipping,
        {
          headers: {
            Token: process.env.GHN_SHOP_TOKEN, // Thêm token vào headers
            ShopId: process.env.GHN_SHOP_ID,
            "Content-Type": "application/json",
          },
        }
      );

      // Nếu tạo đơn hàng thành công
      if (orderCode.data.code === 200) {
        // Cập nhật thông tin giao hàng với mã đơn hàng mới và thời gian giao hàng ước tính
        await Shipping.findByIdAndUpdate(
          { _id: ordered.shipping_info },
          {
            $set: {
              order_code: orderCode.data.data.order_code,
              estimated_delivery_date:
                orderCode.data.data.expected_delivery_time,
            },
          }
        );
      }
    }

    // Cập nhật trạng thái đơn hàng trong cơ sở dữ liệu
    const order = await Order.findByIdAndUpdate(
      id,
      {
        $set: { status: status }, // Cập nhật trạng thái
        $push: {
          status_detail: {
            status: status, // Thêm trạng thái mới vào lịch sử trạng thái
          },
        },
      },
      { new: true } // Trả về bản ghi đã được cập nhật
    ).populate([
      // Populate để lấy thông tin chi tiết từ trường shipping_info
      {
        path: "shipping_info",
      },
    ]);

    // Trả về phản hồi cho người dùng
    return res.json({
      status: 200,
      message: "Cập nhật trạng thái thành công", // Thông báo thành công
      data: order, // Dữ liệu đơn hàng đã được cập nhật
    });
  } catch (error) {
    next(error); // Chuyển lỗi cho middleware xử lý lỗi
  }
};

// cập nhật trạng thái thanh toán của một đơn hàng
export const updatePaymentStatus: RequestHandler = async (req, res, next) => {
  try {
    // Lấy dữ liệu từ yêu cầu
    const { _id, orderInfo } = req.body;

    // Cập nhật trạng thái thanh toán cho đơn hàng
    const order = await Order.findByIdAndUpdate(_id, {
      $set: {
        payment_status: "paid", // Cập nhật trạng thái thanh toán thành "paid"
        payment_method: orderInfo, // Cập nhật phương thức thanh toán với thông tin từ orderInfo
      },
    });

    // Kiểm tra xem đơn hàng có tồn tại hay không
    if (!order) {
      throw createError.NotFound("Không tìm thấy đơn hàng");
    }

    return res.json({
      status: 200,
      message: "Thành công",
    });
  } catch (error) {
    next(error);
  }
};

// hàm xử lý yêu cầu xóa sản phẩm trong đơn hàng
export const deleteOneProduct_order: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { order_id, sku_id } = req.body; // Lấy order_id và sku_id từ yêu cầu

    // Tìm chi tiết đơn hàng tương ứng với order_id và sku_id
    const orderDetail = await Order_Detail.findOne({
      $and: [{ order_id }, { sku_id }],
    });

    // Kiểm tra nếu không tìm thấy chi tiết đơn hàng
    if (!orderDetail) {
      throw createError.NotFound("Không tìm thấy sản phẩm"); // Ném lỗi 404
    }

    // Kiểm tra số lượng sản phẩm
    if (orderDetail.quantity <= 1) {
      throw createError.BadRequest("Ít nhất là 1 sản phẩm"); // Ném lỗi 400 nếu số lượng <= 1
    }

    // Tìm SKU dựa trên sku_id
    const sku = await Sku.findById(sku_id);
    // Kiểm tra nếu không tìm thấy SKU
    if (!sku) {
      throw createError.NotFound("Không tìm thấy SKU"); // Ném lỗi 404
    }

    // Tăng số lượng kho lên 1
    const new_stock = sku.stock + 1;
    // Cập nhật số lượng kho trong cơ sở dữ liệu
    await Sku.findByIdAndUpdate(sku_id, {
      $set: { stock: new_stock },
    });

    // Giảm số lượng sản phẩm trong chi tiết đơn hàng
    orderDetail.quantity--;
    // Cập nhật tổng tiền dựa trên số lượng và giá
    orderDetail.total_money = orderDetail.quantity * orderDetail.price;
    // Lưu thay đổi vào cơ sở dữ liệu
    await orderDetail.save();

    // Tìm tất cả chi tiết đơn hàng dựa trên order_id
    const orderDetails = await Order_Detail.find({ order_id });
    // Tính tổng tiền của đơn hàng
    const total_amount = orderDetails.reduce((total, amount) => {
      return total + (amount.total_money ?? 0); // Cộng tổng tiền, nếu không có thì tính là 0
    }, 0);

    // Cập nhật tổng tiền cho đơn hàng
    const new_order = await Order.findByIdAndUpdate(
      order_id,
      {
        $set: { total_amount }, // Cập nhật tổng tiền
      },
      { new: true } // Trả về tài liệu đã cập nhật
    );

    return res.json({
      status: 200,
      message: "Cập nhật thành công",
      data: new_order, // Dữ liệu của đơn hàng mới
    });
  } catch (error) {
    next(error);
  }
};

// Hàm xử lý lấy danh sách yêu cầu hoàn trả
export const getReturnedOrder: RequestHandler = async (req, res, next) => {
  try {
    // Lấy các tham số tìm kiếm từ query string
    const {
      _page = 1, // Trang hiện tại (mặc định là 1)
      _sort = "created_at", // Trường để sắp xếp (mặc định là created_at)
      _order = "desc", // Thứ tự sắp xếp (mặc định là giảm dần)
      _limit = 10, // Số lượng yêu cầu trả về trên một trang (mặc định là 10)
      search, // Tìm kiếm theo tên khách hàng
      is_confirm, // Tình trạng xác nhận
      date, // Ngày để tìm kiếm
    } = req.query as {
      _page?: number | string; // Trang hiện tại
      _sort?: string; // Trường sắp xếp
      _order?: "asc" | "desc"; // Thứ tự sắp xếp
      _limit?: number | string; // Số lượng yêu cầu trên một trang
      search?: string; // Từ khóa tìm kiếm
      is_confirm?: boolean; // Tình trạng xác nhận
      date?: string; // Ngày tìm kiếm
    };

    // Khởi tạo đối tượng điều kiện tìm kiếm
    const conditions: Record<string, any> = {};

    // Thêm điều kiện tìm kiếm theo tên khách hàng
    if (search) {
      conditions.customer_name = { $regex: new RegExp(search, "i") }; // Tìm kiếm không phân biệt hoa thường
    }

    // Thêm điều kiện xác nhận
    if (is_confirm) {
      conditions.is_confirm = is_confirm; // Thêm điều kiện xác nhận nếu có
    }

    // Thêm điều kiện theo ngày
    if (date) {
      const targetMoment = moment(date); // Chuyển đổi chuỗi ngày thành đối tượng moment
      const yearToSearch = targetMoment.year(); // Năm cần tìm
      const monthToSearch = targetMoment.month(); // Tháng cần tìm
      const dayToSearch = targetMoment.date(); // Ngày cần tìm

      // Đặt điều kiện tìm kiếm theo khoảng thời gian
      conditions.created_at = {
        $gte: new Date(yearToSearch, monthToSearch, dayToSearch), // Ngày bắt đầu
        $lt: new Date(yearToSearch, monthToSearch, dayToSearch + 1), // Ngày kết thúc
      };
    }

    // Tùy chọn cho truy vấn phân trang
    const options = {
      page: Number(_page) || 1,
      limit: Number(_limit) || 10,
      sort: {
        [_sort]: _order === "desc" ? -1 : 1, // Sắp xếp theo trường và thứ tự
      },
      select: ["-deleted", "-deleted_at"], // Chọn các trường để trả về
    };

    // Lấy danh sách yêu cầu hoàn trả từ cơ sở dữ liệu
    const { docs, ...paginate } = await Returned.paginate(conditions, options);

    return res.json({
      status: 200,
      message: "Thành công",
      data: {
        items: docs,
        paginate,
      },
    });
  } catch (error) {
    next(error);
  }
};

// hàm xử lý yêu cầu xóa
export const deleteProduct_order: RequestHandler = async (req, res, next) => {
  try {
    // Lấy order_id và sku_id từ body của yêu cầu
    const { order_id, sku_id } = req.body;

    // Tìm và xóa chi tiết đơn hàng theo order_id và sku_id
    const orderDetail = await Order_Detail.findOneAndDelete({
      $and: [{ order_id: order_id }, { sku_id: sku_id }],
    });

    // Kiểm tra xem orderDetail có tồn tại không
    if (!orderDetail) {
      throw createError.NotFound("Không tìm thấy sản phẩm trong đơn hàng");
    }

    // Lấy tất cả chi tiết đơn hàng còn lại cho order_id
    const orderDetails = await Order_Detail.find({ order_id });

    // Tính tổng số tiền mới cho đơn hàng
    const total_amount = orderDetails.reduce((total, amount) => {
      return total + (amount.total_money || 0); // Đảm bảo tổng tiền không bị undefined
    }, 0);

    // Cập nhật tổng số tiền trong đơn hàng
    const new_order = await Order.findByIdAndUpdate(
      order_id,
      {
        $set: {
          total_amount: total_amount,
        },
      },
      { new: true }
    );

    return res.json({
      status: 200,
      message: "Xóa sản phẩm thành công",
      data: new_order,
    });
  } catch (error) {
    next(error);
  }
};

// Lấy tất cả đơn hàng
export const getAllOrder: RequestHandler = async (req, res, next) => {
  try {
    // Lấy tất cả đơn hàng từ cơ sở dữ liệu
    const orders = await Order.find();

    // Sử dụng Promise.all để lấy chi tiết sản phẩm cho mỗi đơn hàng
    const new_docs = await Promise.all(
      orders.map(async (item) => {
        // Tìm chi tiết sản phẩm dựa trên order_id
        const order_details = await Order_Detail.find({ order_id: item._id });
        // Chuyển đổi đơn hàng sang đối tượng thông thường
        const order = item.toObject();
        // Trả về đơn hàng cùng với thông tin sản phẩm
        return {
          ...order,
          products: order_details,
        };
      })
    );

    // Tính tổng số đơn hàng
    const total_order = new_docs.length;

    // Tạo mảng các tên khách hàng duy nhất
    const uniqueCustomers = [
      ...new Set(new_docs.map((item) => item.customer_name)),
    ];
    // Tính số lượng khách hàng duy nhất
    const total_user = uniqueCustomers.length;

    // Tính tổng số tiền từ tất cả các đơn hàng
    const total_order_money = new_docs
      .reduce((total, item) => total + item.total_amount, 0) // Tính tổng số tiền
      .toLocaleString(); // Định dạng thành chuỗi với dấu phân cách số

    // Tính tổng số sản phẩm trong tất cả các đơn hàng
    const total_order_product = new_docs.reduce(
      (total, item) => total + item.products.length,
      0
    );

    // Gửi phản hồi thành công với thông tin đơn hàng
    return res.json({
      status: 200, 
      message: "Lấy toàn bộ đơn hàng thành công", 
      data: {
        total_order, // Tổng số đơn hàng
        total_user, // Tổng số khách hàng duy nhất
        total_order_money, // Tổng số tiền
        total_order_product, // Tổng số sản phẩm
        new_docs, // Danh sách đơn hàng đã lấy
      },
    });
  } catch (error) {
    next(error);
  }
};
