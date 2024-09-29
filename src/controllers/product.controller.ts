import { messagesError, messagesSuccess } from '@/constants/messages';
import Category from '@/models/Category';
import { Product } from '@/models/Product';
import { productSchema } from '@/validations/product.validation';
import { populate } from 'dotenv';
import { RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';

//* Products
const Get_All_Product: RequestHandler = async (req, res, next) => {
  const {
    _page = 1,
    _order = 'desc',
    _limit = 9999,
    _sort = 'createdAt',
    _q = '',
    _categoryId = '',
    _originId = '',
    _minPrice = '',
    _maxPrice = '',
  } = req.query;
  const page = typeof _page === 'string' ? parseInt(_page, 10) : 1;
  const limit = typeof _limit === 'string' ? parseInt(_limit, 10) : 9999;
  const sortField = typeof _sort === 'string' ? _sort : 'createAt';

  const options = {
    page: page,
    limit: limit,
    sort: {
      [sortField]: _order === 'desc' ? -1 : 1,
    },
    populate: ['categoryId'],
  };

  const query: any = {};

  if (_q) {
    query.name = { $regex: _q, $options: 'i' };
  }

  if (_categoryId && typeof _categoryId === 'string') {
    query.categoryId = _categoryId;
  }
  if (_originId && typeof _originId === 'string') {
    const originIds = _originId.split(',').map((id: string) => id.trim());
    query.originId = { $in: originIds };
  }
  if (_minPrice && typeof _minPrice === 'string') {
    query.price = { ...query.price, $gte: parseFloat(_minPrice) };
  }
  if (_maxPrice && typeof _maxPrice === 'string') {
    query.price = { ...query.price, $lte: parseFloat(_maxPrice) };
  }

  try {
    const products = await Product.paginate(query, options);

    if (!products || products.docs.length === 0) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ message: messagesError.BAD_REQUEST });
    }
    const data = await Product.find();
    let maxPrice = 0;
    let minPrice = Number.MAX_SAFE_INTEGER;

    for (const item of data) {
      const price = item.price - (item.price * item.discount) / 100;
      maxPrice = Math.max(maxPrice, price);
      minPrice = Math.min(minPrice, price);
    }
    if (!data) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ message: messagesError.BAD_REQUEST });
    }
    res.status(StatusCodes.CREATED).json({
      message: messagesSuccess.GET_PRODUCT_SUCCESS,

      data: {
        data: products.docs,
        pagination: {
          currentPage: products.page,
          totalPages: products.totalPages,
          totalItems: products.totalDocs,
        },
        maxPrice,
        minPrice,
      },
    });
  } catch (error) {
    next(error);
  }
};
const Get_One_Product: RequestHandler = async (req, res, next) => {
  try {
    const data = await Product.findById(req.params.id).populate('category');
    if (!data) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ message: messagesError.BAD_REQUEST });
    }
    await data.populate('categoryId.productId');

    res.status(StatusCodes.CREATED).json({
      res: messagesSuccess.GET_PRODUCT_SUCCESS,
      data: data,
    });
  } catch (error) {
    next(error);
  }
};
const Create_Product: RequestHandler = async (req, res, next) => {
  try {
    const product = await Product.create(req.body);
    const updateCategory = await Category.findByIdAndUpdate(
      product.categoryId,
      {
        $push: { products: product._id },
      },
      { new: true }
    );
    if (!product || !updateCategory) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: messagesError.BAD_REQUEST,
      });
    }
    res.status(200).json({
      message: messagesSuccess.CREATE_PRODUCT_SUCCESS,
      res: product,
    });
  } catch (error) {
    next(error);
  }
};
const Update_Product: RequestHandler = async (req, res, next) => {
  try {
    const currentData = await Product.findById(req.params.id);
    const data = await Product.findByIdAndUpdate(`${req.params.id}`, req.body, {
      new: true,
    });
    if (!data) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ message: messagesError.BAD_REQUEST });
    }
    await Category.findByIdAndUpdate(currentData?.categoryId, {
      $pull: {
        products: req.params.id,
      },
    });

    await Category.findByIdAndUpdate(data.categoryId, {
      $push: { products: req.params.id },
    });

    res.status(StatusCodes.CREATED).json({
      message: messagesSuccess.UPDATE_PRODUCT_SUCCESS,
      res: data,
    });
  } catch (error) {
    next(error);
  }
};
const Hide_Product: RequestHandler = async (req, res, next) => {
  try {
    const data = await Product.findByIdAndUpdate(
      `${req.params.id}`,
      {
        isHidden: true,
      },
      { new: true }
    );

    if (!data) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: messagesError.BAD_REQUEST,
      });
    }
    res.status(StatusCodes.OK).json({
      message: messagesSuccess.DELETE_PRODUCT_SUCCESS,
      res: data,
    });
  } catch (error) {
    next(error);
  }
};
const Delete_Product: RequestHandler = async (req, res, next) => {
  try {
    const data = await Product.findByIdAndDelete(req.params.id);
    if (!data) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: messagesError.BAD_REQUEST,
      });
    }
    res.status(StatusCodes.OK).json({
      message: messagesSuccess.DELETE_PRODUCT_SUCCESS,
    });
  } catch (error) {
    next(error);
  }
};
const getRelatedProducts: RequestHandler = async (req, res, next) => {
  try {
    const { cate_id, product_id } = req.params;

    if (!cate_id || !product_id) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: messagesError.BAD_REQUEST,
      });
    }
    const relatedProducts = await Product.find({
      categoryId: cate_id,
      _id: { $ne: product_id }, //Not include product is watching
    })
      .limit(10)
      .lean();

    if (relatedProducts.length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: messagesError.BAD_REQUEST,
      });
    }
    // Random product
    const shuffledProducts = relatedProducts.sort(() => 0.5 - Math.random());

    // Choose first 10 products
    const selectedProducts = shuffledProducts.slice(0, 10);

    const populatedProducts = await Product.populate(selectedProducts, [
      { path: 'originId' },
    ]);

    if (!populatedProducts) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: messagesError.BAD_REQUEST,
      });
    }
    res.status(StatusCodes.OK).json({
      res: populatedProducts,
    });
  } catch (error) {
    next(error);
  }
};
export {
  Create_Product,
  Delete_Product,
  Get_All_Product,
  Get_One_Product,
  Hide_Product,
  Update_Product,
  getRelatedProducts,

};
